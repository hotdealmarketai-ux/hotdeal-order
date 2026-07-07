import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  CATEGORIES,
  CATEGORY_ORDER,
  SAEROP_BANK_ACCOUNT,
  SAEROP_ACCOUNT_HOLDER,
  type Category,
} from "@/lib/constants";
import {
  hasOrderWindow,
  isOrderOpen,
  currentWindowStartUtc,
} from "@/lib/deadline";
import { formatKDateTime } from "@/lib/format";
import { kstDayRange, kstToday, labelDate, normalizeDateStr } from "@/lib/date";
import { ReceiptCard } from "@/components/ReceiptCard";
import { SplitPaymentButton } from "@/components/SplitPaymentButton";

const fmt = (n: number) => n.toLocaleString("ko-KR");

export default async function DayReceiptPage(props: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ new?: string; edited?: string; view?: string }>;
}) {
  const user = await requireMerchant();
  const { date: rawDate } = await props.params;
  const { new: isNew, edited, view } = await props.searchParams;
  const date = normalizeDateStr(rawDate);
  const { start, end } = kstDayRange(date);
  const isPastDay = date < kstToday();

  const [orders, invoice] = await Promise.all([
    prisma.order.findMany({
      where: { userId: user.id, createdAt: { gte: start, lt: end } },
      include: { items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invoice.findFirst({
      where: { userId: user.id, date, status: { in: ["ISSUED", "PAID"] } },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    }),
  ]);
  if (orders.length === 0) notFound();

  const sorted = [...orders].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category as Category) -
      CATEGORY_ORDER.indexOf(b.category as Category),
  );
  const windowStart = currentWindowStartUtc();
  const canEditOrder = (createdAt: Date) =>
    !hasOrderWindow(user.role) ||
    (isOrderOpen() && createdAt.getTime() >= windowStart);

  // 입금요청서가 있으면 [발주 목록 / 입금요청서] 선택 탭. 기본은 발주 목록.
  const showInvoiceTab = !!invoice;
  const activeView = showInvoiceTab && view === "invoice" ? "invoice" : "orders";

  type InvItem = NonNullable<typeof invoice>["items"][number];
  const invItemsByCat = new Map<Category, InvItem[]>();
  if (invoice) {
    for (const it of invoice.items) {
      const c = it.category as Category;
      const list = invItemsByCat.get(c) ?? [];
      list.push(it);
      invItemsByCat.set(c, list);
    }
  }
  const invCats = CATEGORY_ORDER.filter((c) => invItemsByCat.has(c));

  return (
    <>
      <Topbar
        backHref="/mypage"
        title={`${labelDate(date)} ${activeView === "invoice" ? "입금요청서" : "발주서"}`}
      />
      <div className="page">
        {isNew === "1" && (
          <div className="notice notice--ai" style={{ marginBottom: 14 }}>
            ✓ 발주가 접수되었어요. 아래 {sorted.length}개 종류로 발주되었어요.
          </div>
        )}
        {edited === "1" && (
          <div className="notice notice--ai" style={{ marginBottom: 14 }}>
            ✓ 발주가 수정되었어요.
          </div>
        )}

        {showInvoiceTab && (
          <div className="cattabs" style={{ marginBottom: 16 }}>
            <Link
              href={`/order/day/${date}`}
              className={`cattab ${activeView === "orders" ? "is-active" : ""}`}
            >
              발주 목록
            </Link>
            <Link
              href={`/order/day/${date}?view=invoice`}
              className={`cattab ${activeView === "invoice" ? "is-active" : ""}`}
            >
              입금요청서
              {invoice?.status === "ISSUED" && (
                <span className="cattab__dot" aria-hidden="true" />
              )}
            </Link>
          </div>
        )}

        {activeView === "invoice" && invoice ? (
          <>
            {invoice.status === "PAID" ? (
              <div className="notice notice--ok" style={{ marginBottom: 14 }}>
                입금이 확인되었습니다. 감사합니다.
                {invoice.paidAt ? ` (${formatKDateTime(invoice.paidAt)})` : ""}
              </div>
            ) : (
              <div className="notice notice--info" style={{ marginBottom: 14 }}>
                아래 금액을 새롭으로 입금해 주세요. 입금이 확인되면 완료로
                표시돼요.
              </div>
            )}

            {invCats.map((c) => {
              const items = invItemsByCat.get(c)!;
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

            <div className="card" style={{ marginTop: 4 }}>
              <div className="kv">
                <span className="kv__k">입금계좌</span>
                <span className="kv__v">{SAEROP_BANK_ACCOUNT}</span>
              </div>
              <div className="kv">
                <span className="kv__k">예금주</span>
                <span className="kv__v">{SAEROP_ACCOUNT_HOLDER}</span>
              </div>
            </div>

            <div className="invgrand">
              <span>총 결제요청 금액</span>
              <b>{fmt(invoice.total)}원</b>
            </div>

            {invoice.status === "ISSUED" && (
              <SplitPaymentButton
                invoiceId={invoice.id}
                alreadyRequested={invoice.splitRequested}
              />
            )}
          </>
        ) : (
          <>
            {/* 지점명은 맨 위 한 번만 — 그 아래로 카테고리별 영수증 나열 */}
            <div style={{ marginBottom: 18 }}>
              <div className="receipt__store">{user.storeName}</div>
              {user.phone && (
                <div className="row__sub" style={{ marginTop: 2 }}>
                  {user.phone}
                </div>
              )}
            </div>
            {sorted.map((order) => {
            const cat = CATEGORIES[order.category as Category];
            return (
              <div key={order.id} style={{ marginBottom: 22 }}>
                <div className="spread" style={{ marginBottom: 8 }}>
                  <span className="chip">{cat.label}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {isPastDay ? (
                      <span className="badge badge--ok">완료</span>
                    ) : order.confirmed ? (
                      <span className="badge badge--ok">확인됨 · 준비 중</span>
                    ) : null}
                    {canEditOrder(order.createdAt) && (
                      <Link
                        href={`/order/${order.id}/edit`}
                        className="btn btn--xs btn--soft"
                      >
                        수정
                      </Link>
                    )}
                  </div>
                </div>
                <ReceiptCard
                  storeName={user.storeName}
                  phone={user.phone}
                  categoryLabel={cat.label}
                  vendorLabel={cat.vendorLabel}
                  dateText={formatKDateTime(order.createdAt)}
                  pickupTime={order.pickupTime}
                  aiSummary={order.aiSummary}
                  aiEngine={order.aiEngine}
                  items={order.items.map((it) => ({
                    name: it.name,
                    qty: it.qty,
                    note: it.note,
                  }))}
                  rawItems={order.items.map((it) => ({
                    rawName: it.rawName,
                    rawQty: it.rawQty,
                    rawNote: it.rawNote,
                  }))}
                  rawText={order.rawText}
                  showStore={false}
                  showPrintButton={false}
                />
              </div>
            );
          })}
          </>
        )}
      </div>
    </>
  );
}
