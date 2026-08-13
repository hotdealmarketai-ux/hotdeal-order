// 서버 렌더(인증·초기 조회) 동안 흰 화면 대신 즉시 보여줄 셸. 코발트 스코프(.mw).
export default function Loading() {
  return (
    <div className="mw" aria-busy="true">
      <div className="mw__main">
        <div className="mw__top">
          <span className="mw__toptitle">메신저</span>
        </div>
        <div className="mw__blank">불러오는 중…</div>
      </div>
    </div>
  );
}
