import type { Metadata, Viewport } from "next";

// PC 재고관리 — 모바일 셸(고정폭 .app)과 별개의 풀스크린 데스크톱 화면(창고관리와 동일 구조).
export const metadata: Metadata = { title: "재고관리 · 오더야" };

// 루트는 핀치줌 차단(모바일)이지만, PC 화면이라 확대/축소를 허용해 덮어쓴다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1c4a2f",
};

export default function InventoryPcLayout({ children }: { children: React.ReactNode }) {
  return <div className="invpc">{children}</div>;
}
