// #12 재고 구글시트 → DB 동기화(시트가 기준). 공개(링크공유) 시트를 CSV export로 무인증 조회.
// 컬럼: A=품목명, B=남은수량, C=공급가. 1행은 헤더. 1분 크론(api/cron/inventory-sync)에서 호출.
// DB→시트(쓰기)는 Google 서비스계정 크레덴셜 필요 → 별도(blocked). 여기는 읽기 동기화만.
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";

const SHEET_ID =
  process.env.INVENTORY_SHEET_ID ||
  "1LlMirhN-ChqWKmzilH1_EX7yeDLK26SI-H61bvgGEG0";
const GID = process.env.INVENTORY_SHEET_GID || "0";

// 최소 CSV 파서 — 따옴표 필드/콤마/개행 처리.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const toInt = (s: string | undefined) =>
  parseInt(String(s ?? "").replace(/[^0-9-]/g, ""), 10) || 0;

export async function syncInventoryFromSheet(): Promise<{
  ok: boolean;
  count?: number;
  error?: string;
}> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
  let text: string;
  try {
    const res = await fetch(url, { cache: "no-store", redirect: "follow" });
    if (!res.ok) return { ok: false, error: `sheet fetch ${res.status}` };
    text = await res.text();
    // 비공개면 로그인 HTML이 옴 → CSV 아닌지 방어(재고를 지우지 않도록).
    if (text.trimStart().startsWith("<")) {
      return { ok: false, error: "시트가 공개(링크공유)가 아니에요. '링크가 있는 모든 사용자 보기'로 공유해 주세요." };
    }
  } catch (err) {
    logError("inventory.sheetFetch", err, {});
    return { ok: false, error: "시트 조회 실패" };
  }

  const rows = parseCsv(text);
  const items = rows
    .slice(1) // 헤더 제외
    .map((r) => ({
      name: (r[0] ?? "").trim(),
      qty: toInt(r[1]),
      supplyPrice: toInt(r[2]),
    }))
    .filter((it) => it.name);

  // 빈 응답이면 DB를 지우지 않는다(전량 삭제 사고 방지).
  if (items.length === 0) return { ok: false, error: "시트에 품목이 없어요" };

  const names = items.map((i) => i.name);
  await prisma.$transaction(async (tx) => {
    // 시트=기준: 시트에 없는 품목은 삭제(삭제 전파).
    await tx.inventoryItem.deleteMany({ where: { name: { notIn: names } } });
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const existing = await tx.inventoryItem.findFirst({
        where: { name: it.name },
        select: { id: true },
      });
      if (existing) {
        await tx.inventoryItem.update({
          where: { id: existing.id },
          data: { qty: it.qty, supplyPrice: it.supplyPrice, sortOrder: i },
        });
      } else {
        await tx.inventoryItem.create({
          data: {
            name: it.name,
            qty: it.qty,
            supplyPrice: it.supplyPrice,
            sortOrder: i,
            status: "",
          },
        });
      }
    }
  });

  await prisma.appMeta.upsert({
    where: { key: "inventory_sync" },
    create: { key: "inventory_sync" },
    update: { syncedAt: new Date() },
  });
  return { ok: true, count: items.length };
}

export async function lastInventorySyncAt(): Promise<Date | null> {
  const m = await prisma.appMeta
    .findUnique({ where: { key: "inventory_sync" } })
    .catch(() => null);
  return m?.syncedAt ?? null;
}
