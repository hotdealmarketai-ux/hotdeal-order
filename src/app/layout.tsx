import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PushForegroundListener } from "@/components/PushForegroundListener";
import { PushSubscriptionSync } from "@/components/PushSubscriptionSync";
import { ChatWidget } from "@/components/ChatWidget";

const TITLE = "핫딜오더";
const DESCRIPTION = "주문은 더 간편하게, 운영은 더 스마트하게.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.orderya.xyz"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "핫딜오더",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // #1 손가락 확대/축소(핀치줌) 완전 차단 — 화면이 늘거나 줄지 않게 고정
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  themeColor: "#1C4A2F", // 핫딜오더 브랜드 그린(헤더 메인)
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <PushSubscriptionSync />
        <PushForegroundListener />
        {children}
        <ChatWidget />
      </body>
    </html>
  );
}
