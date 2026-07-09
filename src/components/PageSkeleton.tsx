// 페이지 전환 중 즉각 표시되는 로딩 스켈레톤(서버 렌더 대기 동안).
export function PageSkeleton() {
  return (
    <div className="page" aria-hidden="true">
      <div className="sk sk--title" />
      <div className="list">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="sk sk--row" key={i} />
        ))}
      </div>
    </div>
  );
}
