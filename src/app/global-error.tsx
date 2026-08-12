"use client";

// 루트 레이아웃에서 던져진 오류까지 잡는 최상위 폴백(화이트스크린 방지).
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f7f3",
          color: "#17211b",
          fontFamily: "system-ui, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 360 }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>일시적인 오류가 발생했어요</div>
          <div style={{ color: "#4a5a50", fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
            잠시 후 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요.
          </div>
          <button
            type="button"
            onClick={() => reset()}
            style={{ background: "#1c4a2f", color: "#fff", border: 0, borderRadius: 10, padding: "11px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
