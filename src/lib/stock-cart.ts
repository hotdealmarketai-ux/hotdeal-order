// #6 재고 담기 — localStorage 기반(날짜별 키 → 다음날 자동 초기화). 공구(TOOL)로 발주에 자동 임시저장.
// 재고 남은수량은 차감하지 않는다(#23). 발주창이 열려 있고 발주시간일 때만 담을 수 있다.
export type StockCartItem = { name: string; qty: string };

const PREFIX = "hd_tool_cart_";
const keyOf = (date: string) => PREFIX + date;

export function getStockCart(date: string): StockCartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(keyOf(date));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function setStockCart(date: string, items: StockCartItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(keyOf(date), JSON.stringify(items));
    // 오래된 날짜 키 정리(다음날 초기화 보장)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k !== keyOf(date)) localStorage.removeItem(k);
    }
  } catch {}
}

export function addToStockCart(date: string, item: StockCartItem) {
  const cart = getStockCart(date);
  const idx = cart.findIndex((c) => c.name === item.name);
  if (idx >= 0) cart[idx] = item;
  else cart.push(item);
  setStockCart(date, cart);
}

export function removeFromStockCart(date: string, name: string) {
  setStockCart(
    date,
    getStockCart(date).filter((c) => c.name !== name),
  );
}
