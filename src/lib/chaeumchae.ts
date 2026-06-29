// 채움채(두부/콩나물) 취급 품목 — 고정 5종. 발주 체크리스트 + 자동제출 매핑에 사용.
// seq = 채움채 사이트의 product_seq (api_customer_order_product_insert 용)
export interface ChaeumchaeProduct {
  seq: string;
  name: string;
}

export const CHAEUMCHAE_CATALOG: ChaeumchaeProduct[] = [
  { seq: "100013", name: "비타 수입 봉지콩 300g 아삭통통" },
  { seq: "100056", name: "아삭채움 숙주봉지 500g" },
  { seq: "100040", name: "강릉두부 500g" },
  { seq: "100042", name: "강릉순두부 600g 몽글" },
  { seq: "100102", name: "맑은결 손두부 500g" },
];

// 품목명 → seq (자동제출 시 정확 매핑). 체크리스트로 넣으면 이름이 정확히 일치함.
export function seqForName(name: string): string | null {
  const hit = CHAEUMCHAE_CATALOG.find((p) => p.name === name.trim());
  return hit ? hit.seq : null;
}
