import { prisma } from "@/lib/prisma";

// 채움채 상품(DB, 상품관리에서 편집) — 박스입수·낱개단가·과세면세·단위.
export type ChaeumchaeProductRow = {
  id: string;
  seq: string;
  name: string;
  hasBox: boolean;
  perBox: number; // 박스당 낱개 입수
  piecePrice: number; // 낱개 단가
  unit: string; // 낱개 단위(개/모 등)
  tax: string; // 과세/면세/미선택
  sortOrder: number;
  active: boolean; // 활성 여부 — 환산 조인에서 소프트삭제된 옛 상품보다 활성 상품을 우선하기 위함
};

// 활성 채움채 상품 목록(상품관리 sortOrder 순).
export async function getChaeumchaeProducts(): Promise<ChaeumchaeProductRow[]> {
  return prisma.chaeumchaeProduct.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      seq: true,
      name: true,
      hasBox: true,
      perBox: true,
      piecePrice: true,
      unit: true,
      tax: true,
      sortOrder: true,
      active: true,
    },
  });
}

// 계산서 박스→낱개 '환산 조인' 전용 맵 — active 무관(소프트삭제 포함)으로 seq·이름 양쪽 인덱스.
//   · 발주는 하드코딩 카탈로그(chaeumchae.ts) 기준이라, 상품을 소프트삭제(active=false)해도 발주는 계속 들어온다.
//     그 진행 중 발주가 환산되려면 삭제된 상품도 조회돼야 오청구(누락/1개환산)를 막는다.
//   · 조인 우선순위: 발주 품목명→seq(카탈로그, 이름변경에 강함) → seq맵. seq가 비었거나(재추가행) 못 찾으면 이름맵 폴백.
//   · active 상품을 우선(active desc)해 같은 seq/이름이 겹치면 현재 설정을 쓴다.
export async function chaeumchaeConversionMaps(): Promise<{
  bySeq: Record<string, ChaeumchaeProductRow>;
  byName: Record<string, ChaeumchaeProductRow>;
}> {
  const list = await prisma.chaeumchaeProduct.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      seq: true,
      name: true,
      hasBox: true,
      perBox: true,
      piecePrice: true,
      unit: true,
      tax: true,
      sortOrder: true,
      active: true,
    },
  });
  const bySeq: Record<string, ChaeumchaeProductRow> = {};
  const byName: Record<string, ChaeumchaeProductRow> = {};
  for (const p of list) {
    const s = p.seq.trim();
    if (s && !bySeq[s]) bySeq[s] = p;
    const n = p.name.trim();
    if (n && !byName[n]) byName[n] = p;
  }
  return { bySeq, byName };
}
