import type { Metadata, Viewport } from "next";
import "./globals.css";

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
  // 어르신 확대 가능하도록 maximumScale 제한하지 않음
  themeColor: "#0b1120",
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
