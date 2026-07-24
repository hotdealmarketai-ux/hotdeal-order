"use server";

import { getCurrentUser } from "@/lib/session";
import { isMerchant } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { heldByItem, myHolds } from "@/lib/stock-hold";
import { windowKeyAt } from "@/lib/schedule";
import { orderOpenNow } from "@/lib/order-open";
import { hasOrderWindow, currentWindowStartUtc } from "@/lib/deadline";
import { askAssistant, type AssistantMsg } from "@/lib/assistant";
import {
  rankStockMatches,
  hasStockIntent,
  type StockMatch,
} from "@/lib/stock-match";

const won = (n: number) => n.toLocaleString("ko-KR");

export type AssistantReply = {
  ok: boolean;
  text: string;
  stock?: StockMatch[]; // 재고 문의로 판단되면 매칭된 품목(챗봇 안 담기/빼기용)
  canAdd?: boolean; // 지금 담을 수 있는 시간인지(=재고현황 담기 조건과 동일)
};

// 사용자 마지막 질문에서 '재고현황'과 연동해 비슷한 품목을 찾고, 실시간 남은수량을 계산한다.
// 재고 계산·조건은 재고현황 페이지(inventory/page.tsx)와 완전히 동일한 구조를 그대로 사용.
async function findStock(
  userId: string,
  role: string,
  query: string,
): Promise<{ matches: StockMatch[]; canAdd: boolean; found: boolean } | null> {
  // 재고 담기는 핫딜마켓 가맹점 기능 — 그 외 역할은 재고 카드 없음.
  if (role !== "MERCHANT_HOTDEAL") return null;

  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, qty: true, supplyPrice: true },
  });
  if (items.length === 0) return null;

  const ranked = rankStockMatches(query, items).filter((r) => r.score >= 12);
  // 재고를 묻는 의도이거나(재고/남았/몇 개 등) 품목명을 통째로 말한 강한 매칭일 때만 카드를 띄운다.
  const surface = ranked.length > 0 && (hasStockIntent(query) || ranked[0].strong);
  if (!surface) return null;

  const holdKey = windowKeyAt();
  const [held, mineRows] = await Promise.all([
    heldByItem(holdKey),
    myHolds(userId, holdKey),
  ]);
  const mineMap: Record<string, number> = {};
  for (const h of mineRows) mineMap[h.itemId] = h.qty;

  // 담기 가능 조건 — 재고현황 페이지와 동일: 발주 시간(또는 강제오픈) + 이번 창에 아직 발주 없음.
  let canAdd = await orderOpenNow(role);
  if (canAdd && hasOrderWindow(role)) {
    const since = new Date(currentWindowStartUtc());
    const existing = await prisma.order.findFirst({
      where: { userId, createdAt: { gte: since }, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (existing) canAdd = false;
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const matches: StockMatch[] = ranked.map((r) => {
    const it = byId.get(r.id)!;
    return {
      itemId: it.id,
      name: it.name,
      available: Math.max(0, it.qty - (held[it.id] ?? 0)),
      mine: mineMap[it.id] ?? 0,
      supplyPrice: it.supplyPrice,
    };
  });
  return { matches, canAdd, found: true };
}

function stockContext(matches: StockMatch[], canAdd: boolean): string {
  const lines = matches
    .map(
      (m) =>
        `- ${m.name}: 남은 수량 ${m.available}개` +
        (m.mine > 0 ? ` (사장님이 담아둔 것 ${m.mine}개)` : "") +
        (m.supplyPrice > 0 ? ` · 공급가 ${won(m.supplyPrice)}원` : ""),
    )
    .join("\n");
  return `[재고 조회 결과 — 이 수치로만 답하세요. 지어내지 마세요]
사장님 질문에서 아래 재고 품목을 찾았어요:
${lines}

답변 규칙:
- 찾은 품목의 남은 수량을 알려주세요. 여러 개면 어떤 게 맞는지 되물어도 좋아요.
${
  canAdd
    ? '- 담고 싶어 하시면 "아래 담기 버튼으로 바로 담으실 수 있어요"라고 안내하세요(버튼은 이 답변 아래에 자동으로 나와요).'
    : '- 지금은 발주 시간이 아니라 담기는 안 돼요. 남은 수량만 알려드리고 "발주 시간(낮 12시~저녁 8시)에 담으실 수 있어요"라고 안내하세요.'
}
- 위 목록에 없는 품목을 물으시면 "재고현황에 그 품목은 없어요. 관리자 문의로 여쭤봐 주세요"라고 하세요.`;
}

// #9 AI 도우미 — 가맹점주만. 대화 기록(history)을 받아 답변 1개 반환.
// 재고를 물으면 재고현황과 연동해 남은 수량을 알려주고, 챗봇 안에서 담기/빼기까지 가능(stock 반환).
export async function askAssistantAction(
  history: AssistantMsg[],
): Promise<AssistantReply> {
  const user = await getCurrentUser();
  if (!user || user.status !== "APPROVED" || !isMerchant(user.role)) {
    return { ok: false, text: "" };
  }
  const clean: AssistantMsg[] = (Array.isArray(history) ? history : [])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    )
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 2000) }))
    .slice(-12);
  if (!clean.length || clean[clean.length - 1].role !== "user") {
    return { ok: false, text: "" };
  }

  const lastMsg = clean[clean.length - 1].content;
  let stock: StockMatch[] | undefined;
  let canAdd: boolean | undefined;
  let systemExtra = "";
  try {
    const found = await findStock(user.id, user.role, lastMsg);
    if (found) {
      stock = found.matches;
      canAdd = found.canAdd;
      systemExtra = stockContext(found.matches, found.canAdd);
    }
  } catch {
    /* 재고 조회 실패해도 일반 답변은 진행 */
  }

  const text = await askAssistant(clean, systemExtra);
  return { ok: true, text, stock, canAdd };
}
