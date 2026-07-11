import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { labelDate } from "@/lib/date";

const fmt = (n: number) => n.toLocaleString("ko-KR");

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "작성중", cls: "badge--mute" },
  ISSUED: { label: "입금 대기", cls: "badge--wait" },
  PAID: { label: "입금 완료", cls: "badge--ok" },
  VOID: { label: "취소됨", cls: "badge--mute" },
};

export default async function AdminInvoices() {
  await requireAdmin();

  const [ar, invoices] = await Promise.all([
    prisma.invoice.aggregate({
      where: { status: "ISSUED", kind: "DAILY" },
      _sum: { total: true },
      _count: true,
    }),
    prisma.invoice.findMany({
      where: { kind: "DAILY" }, // 주간(WEEKLY)은 /admin/weekly 에서 별도 관리
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: { user: { select: { storeName: true } } },
    }),
  ]);
  const arSum = ar._sum.total ?? 0;

  return (
    <>
      <Topbar backHref="/admin" title="계산서·미수" />
      <div className="page">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row__sub">미수 합계 (발행 후 미입금)</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>
            {fmt(arSum)}원
          </div>
          <div className="row__sub" style={{ marginTop: 2 }}>
            입금 대기 {ar._count}건
          </div>
        </div>

        <p className="hint" style={{ marginBottom: 12 }}>
          계산서는 각 날짜 합본 발주서에서 &lsquo;계산서 작성&rsquo;으로
          만들어요.
        </p>

        {invoices.length === 0 ? (
          <div className="empty">
            <p>아직 계산서가 없어요.</p>
          </div>
        ) : (
          <div className="list">
            {invoices.map((inv) => {
              const badge = STATUS_BADGE[inv.status] ?? STATUS_BADGE.DRAFT;
              return (
                <Link
                  href={`/admin/invoices/${inv.id}`}
                  className="row"
                  key={inv.id}
                >
                  <div className="row__main">
                    <div className="row__title">{inv.user.storeName}</div>
                    <div className="row__sub">
                      {labelDate(inv.date)} · {fmt(inv.total)}원
                    </div>
                  </div>
                  <span className={`badge ${badge.cls}`}>{badge.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
