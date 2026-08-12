import type { Metadata, Viewport } from "next";

// 사내 메신저 = 핫딜오더에서 완전 분리된 워크스페이스. (admin) 그룹 밖 최상위 라우트라
// AdminNav/Topbar 등 핫딜오더 크롬이 전혀 붙지 않는다(창고관리와 동일 방식).
export const metadata: Metadata = { title: "사내 메신저 · 오더야" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1c4a2f" };

export default function MessengerLayout({ children }: { children: React.ReactNode }) {
  return <div className="mw-root">{children}</div>;
}
