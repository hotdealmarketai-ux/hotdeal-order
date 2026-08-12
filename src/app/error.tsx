"use client";

// 라우트 그룹별 폴백 — /messenger·/login·/warehouse 등 자체 error 경계가 없는 곳도 화이트스크린 대신 재시도 화면.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "system-ui, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: "#17211b" }}>문제가 발생했어요</div>
        <div style={{ color: "#6b7a70", fontSize: 14, lineHeight: 1.5, marginBottom: 18 }}>잠시 후 다시 시도해 주세요.</div>
        <button
          type="button"
          onClick={() => reset()}
          style={{ background: "#1c4a2f", color: "#fff", border: 0, borderRadius: 10, padding: "10px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
