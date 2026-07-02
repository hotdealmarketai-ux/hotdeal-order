import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  allowedCategoriesFor,
  CATEGORIES,
  CATEGORY_ORDER,
  type Category,
  type Role,
} from "@/lib/constants";
import { kstDayRange, labelDate } from "@/lib/date";
import { formatKDateTime } from "@/lib/format";
import {
  InvoiceForm,
  type InvoiceInitialItem,
  type InvoiceRefGroup,
} from "@/components/InvoiceForm";
import { InvoiceAdminActions } from "@/components/InvoiceAdminActions";

const fmt = (n: number) => n.toLocaleString("ko-KR");

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "작성중", cls: "badge--mute" },
  ISSUED: { label: "입금 대기", cls: "badge--wait" },
  PAID: { label: "입금 완료", cls: "badge--ok" },
  VOID: { label: "취소됨", cls: "badge--mute" },
};

export default async function AdminInvoiceDetail(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ issued?: string; saved?: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const { issued, saved } = await props.searchParams;

  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      user: true,
    },
  });
  if (!inv) notFound();

  // 작성중이면 편집 화면(발주 참고 포함)
  if (inv.status === "DRAFT") {
    const { start, end } = kstDayRange(inv.date);
    const orders = await prisma.order.findMany({
      where: { userId: inv.userId, createdAt: { gte: start, lt: end } },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    const refMap = new Map<Category, InvoiceRefGroup["items"]>();
    for (const o of orders) {
      const c = o.category as Category;
      const list = refMap.get(c) ?? [];
      for (const it of o.items) {
        list.push({
          name: it.name || it.rawName,
          qty: it.qty || it.rawQty,
          note: it.note || it.rawNote,
        });
      }
      refMap.set(c, list);
    }
    const refGroups: InvoiceRefGroup[] = CATEGORY_ORDER.filter((c) =>
      refMap.has(c),
    ).map((c) => ({ category: c, items: refMap.get(c)! }));

    const initialItems: InvoiceInitialItem[] = inv.items.map((it) => ({
      category: it.category as Category,
      name: it.name,
      qty: String(it.qty),
      unitPrice: String(it.unitPrice),
    }));
    const allowed = allowedCategoriesFor(inv.user.role as Role);
    const categories = allowed.length ? allowed : [...CATEGORY_ORDER];

    return (
      <>
        <header className="topbar">
          <Link href="/admin/invoices" className="topbar__back" aria-label="뒤로">
            ‹
          </Link>
          <div className="topbar__title">계산서 작성중</div>
        </header>
        <div className="page">
          {saved === "1" && (
            <div className="notice notice--ok" style={{ marginBottom: 14 }}>
              ✓ 임시저장되었어요. 이어서 작성할 수 있어요.
            </div>
          )}
          <h1 className="h1">{inv.user.storeName}</h1>
          <p className="lead" style={{ marginTop: 4 }}>
            {labelDate(inv.date)} 출고분 계산서
          </p>
          <InvoiceForm
            invoiceId={inv.id}
            userId={inv.userId}
            date={inv.date}
            categories={categories}
            initialItems={initialItems}
            initialMemo={inv.memo}
            refGroups={refGroups}
          />
        </div>
      </>
    );
  }

  // 발행/입금완료/취소 — 읽기 전용 + 상태 액션
  const badge = STATUS_BADGE[inv.status] ?? STATUS_BADGE.DRAFT;
  const cats = CATEGORY_ORDER.filter((c) =>
    inv.items.some((it) => it.category === c),
  );

  return (
    <>
      <header className="topbar">
        <Link href="/admin/invoices" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">계산서</div>
      </header>
      <div className="page">
        {issued === "1" && (
          <div className="notice notice--ok" style={{ marginBottom: 14 }}>
            ✓ 계산서가 발행되었어요. 점주에게 입금요청 알림을 보냈어요.
          </div>
        )}
        {inv.status === "VOID" && (
          <div className="notice notice--mute" style={{ marginBottom: 14 }}>
            취소된 계산서예요. 다시 보내려면{" "}
            <Link
              href={`/admin/combined/${inv.userId}/${inv.date}`}
              style={{ textDecoration: "underline" }}
            >
              합본 발주서
            </Link>
            에서 새로 작성하세요.
          </div>
        )}
        {inv.status === "PAID" && inv.paidAt && (
          <div className="notice notice--ok" style={{ marginBottom: 14 }}>
            {formatKDateTime(inv.paidAt)} 입금 확인됨
          </div>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="spread">
            <div>
              <div className="receipt__store">{inv.user.storeName}</div>
              <div className="receipt__meta" style={{ marginTop: 4 }}>
                {labelDate(inv.date)} 출고분
                {inv.issuedAt ? ` · ${formatKDateTime(inv.issuedAt)} 발행` : ""}
              </div>
            </div>
            <span className={`badge ${badge.cls}`}>{badge.label}</span>
          </div>
        </div>

        {cats.map((c) => {
          const items = inv.items.filter((it) => it.category === c);
          const sum = items.reduce((n, it) => n + it.amount, 0);
          return (
            <div className="invcat" key={c}>
              <div className="invcat__head">
                <span className="chip">{CATEGORIES[c].label}</span>
                <span className="invcat__sum">{fmt(sum)}원</span>
              </div>
              {items.map((it) => (
                <div className="invline" key={it.id}>
                  <span>
                    {it.name}
                    <span className="invline__meta">
                      {String(it.qty)} × {fmt(it.unitPrice)}
                    </span>
                  </span>
                  <span className="invline__amt">{fmt(it.amount)}</span>
                </div>
              ))}
            </div>
          );
        })}

        {inv.memo && (
          <div className="card" style={{ marginTop: 4 }}>
            <div className="kv">
              <span className="kv__k">메모</span>
              <span className="kv__v">{inv.memo}</span>
            </div>
          </div>
        )}

        <div className="invgrand">
          <span>총 결제요청 금액</span>
          <b>{fmt(inv.total)}원</b>
        </div>

        <InvoiceAdminActions
          invoiceId={inv.id}
          status={inv.status}
          total={inv.total}
        />
      </div>
    </>
  );
}
