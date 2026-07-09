"use client";

// 페이지 렌더 중 오류가 났을 때 보여주는 친절한 경계 UI. reset()으로 재시도.
export function ErrorBox({ reset }: { error: Error; reset: () => void }) {
  return (
    <div
      className="page"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minHeight: "60vh",
      }}
    >
      <div className="center">
        <div style={{ fontSize: 44 }}>⚠️</div>
        <h1 className="h1">잠시 문제가 생겼어요</h1>
        <p className="lead">잠깐 후 다시 시도해 주세요.</p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => reset()}
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
