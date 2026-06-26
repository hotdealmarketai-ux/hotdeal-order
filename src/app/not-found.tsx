import Link from "next/link";

export default function NotFound() {
  return (
    <div className="app">
      <div
        className="page"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minHeight: "70vh",
        }}
      >
        <div className="center">
          <div style={{ fontSize: 48 }}>🧐</div>
          <h1 className="h1">페이지를 찾을 수 없어요</h1>
          <p className="lead">주소가 바뀌었거나 삭제된 페이지예요.</p>
          <Link href="/" className="btn btn--primary">
            처음으로
          </Link>
        </div>
      </div>
    </div>
  );
}
