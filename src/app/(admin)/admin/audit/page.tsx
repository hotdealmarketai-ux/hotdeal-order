import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatKStamp } from "@/lib/format";

// 관리자 파괴적 작업 감사 로그 — 삭제·취소·초기화 이력. 되돌릴 수 없는 작업의 추적·복구 참고용.
const ACTION_LABEL: Record<string, string> = {
  "member.delete": "회원 삭제",
  "orders.resetAll": "발주 전체 초기화",
  "orders.cancelStore": "지점 발주 취소",
  "invoice.void": "계산서 취소",
};

export default async function AdminAudit() {
  await requireAdmin();
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <>
      <Topbar backHref="/admin" title="감사 로그" />
      <div className="page">
        <p className="lead" style={{ marginTop: 0 }}>
          관리자의 삭제·취소·초기화 작업 최근 {logs.length}건. 되돌릴 수 없는 작업의 추적·복구
          참고용이에요.
        </p>

        {logs.length === 0 ? (
          <div className="empty">
            <p>아직 기록된 작업이 없습니다.</p>
          </div>
        ) : (
          <div className="list">
            {logs.map((l) => (
              <div className="row" key={l.id}>
                <div className="row__main">
                  <div className="row__title">
                    {ACTION_LABEL[l.action] ?? l.action}
                  </div>
                  {l.summary && <div className="row__sub">{l.summary}</div>}
                  <div className="row__sub" style={{ opacity: 0.65 }}>
                    {formatKStamp(l.createdAt)} · {l.actorName || l.actorId}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
