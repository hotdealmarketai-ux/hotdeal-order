// 챗봇 재고 질의 — 사용자 문장에서 재고 품목을 유사도로 찾는 순수 매칭(prisma 없음, 서버·클라 공용).
// "간장새우장 재고 있어?" · "새우장 몇 개?" · "두부 남았나요?" 같은 문장에서 비슷한 품목을 찾는다.

// 챗봇이 클라이언트로 넘겨 StockCartButton(기존 담기/빼기)에 그대로 꽂는 형태.
export type StockMatch = {
  itemId: string;
  name: string;
  available: number; // 실시간 남은수량(기준재고 − 전체 담기)
  mine: number; // 내가 담은 수량
  supplyPrice: number;
};

const norm = (s: string) => (s ?? "").replace(/\s+/g, "").toLowerCase();

// 문장을 토큰으로(2글자 이상). 조사·기호는 대충 제거.
function tokens(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^가-힣a-z0-9]+/gi, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

export type RankItem = { id: string; name: string };
export type RankResult = { id: string; name: string; score: number; strong: boolean };

// 문장과 품목명을 대조해 점수화. 문장이 품목명을 통째로 포함하거나(강한 매칭),
// 토큰이 겹치면(비슷한 제품) 점수를 준다.
export function rankStockMatches(
  query: string,
  items: RankItem[],
  limit = 6,
): RankResult[] {
  const nq = norm(query);
  const qTokens = tokens(query);
  const out: RankResult[] = [];
  for (const it of items) {
    const nn = norm(it.name);
    if (!nn) continue;
    let score = 0;
    let strong = false;
    if (nq.includes(nn)) {
      score += 100; // 문장이 품목명 전체를 포함(예: "간장새우장 담아줘")
      strong = true;
    } else if (nq.length >= 2 && nn.includes(nq)) {
      score += 60; // 품목명이 질문 전체를 포함(예: "새우장" → "간장새우장")
      strong = true;
    }
    for (const qt of qTokens) if (nn.includes(qt)) score += 12; // 질문 토큰이 품목명에
    for (const nt of tokens(it.name)) if (nq.includes(nt)) score += 8; // 품목명 토큰이 질문에
    if (score > 0) out.push({ id: it.id, name: it.name, score, strong });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"));
  return out.slice(0, limit);
}

// 재고를 묻는 의도인지(품목명 매칭과 함께 '재고 카드'를 띄울지 판단하는 게이트)
const STOCK_INTENT = [
  "재고", "남았", "남은", "남아", "있어", "있나", "있는", "있습", "있을",
  "몇개", "몇 개", "수량", "얼마", "담", "판매", "팔아", "주문", "살", "구매",
];
export function hasStockIntent(query: string): boolean {
  const q = (query ?? "").toLowerCase();
  return STOCK_INTENT.some((k) => q.includes(k));
}
