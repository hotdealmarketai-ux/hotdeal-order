import type { Metadata, Viewport } from "next";

// 사내 메신저 = 핫딜오더에서 완전 분리된 워크스페이스. (admin) 그룹 밖 최상위 라우트라
// AdminNav/Topbar 등 핫딜오더 크롬이 전혀 붙지 않는다(창고관리와 동일 방식).
// 홈 화면에 '메신저'만 별도 앱으로 추가할 수 있게 라우트 전용 PWA 매니페스트/아이콘/iOS 메타를 붙인다.
// (start_url=/messenger, scope=/messenger, standalone → 눌러 열면 브라우저 없이 바로 메신저)
export const metadata: Metadata = {
  title: "핫딜마켓 메신저",
  manifest: "/messenger.webmanifest",
  appleWebApp: { capable: true, title: "핫딜마켓 메신저", statusBarStyle: "default" },
  icons: { apple: "/messenger-apple-icon.png" },
  // Next는 mobile-web-app-capable만 내보내는데, iOS(특히 구형)는 apple- 접두어를 봐야
  // 홈화면 실행 시 브라우저 크롬 없이 전체화면(standalone)으로 뜬다 → 명시적으로 추가.
  other: { "apple-mobile-web-app-capable": "yes" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1e3a9e" };

export default function MessengerLayout({ children }: { children: React.ReactNode }) {
  return <div className="mw-root">{children}</div>;
}
