import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "핫딜마켓 발주",
  description: "핫딜마켓 가맹점 · 서부일광 발주 플랫폼",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 어르신 확대 가능하도록 maximumScale 제한하지 않음
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
