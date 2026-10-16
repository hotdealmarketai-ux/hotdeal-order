import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { notFound, redirect } from "next/navigation";
import { requireMerchant } from "@/lib/session";
import { needsOnboarding } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";
import {
  CATEGORIES,
  CATEGORY_ORDER,
  SAEROP_BANK_ACCOUNT,
  SAEROP_ACCOUNT_HOLDER,
  type Category,
} from "@/lib/constants";
import { hasOrderWindow, isOrderOpen } from "@/lib/deadline";
import { formatKDateTime } from "@/lib/format";
import {
  dowOf,
  labelDate,
  normalizeDateStr,
  shiftDate,
  shipmentDayOf,
} from "@/lib/date";
import { normalizeWindowKey, windowKeyAt } from "@/lib/schedule";
import { windowCreatedRange } from "@/lib/order-plan";
import { orderTimeOpenForUser } from "@/lib/receivable";
import { ReceiptCard } from "@/components/ReceiptCard";
import { SplitPaymentButton } from "@/components/SplitPaymentButton";
import { PrintButton } from "@/components/PrintButton";

const fmt = (n: number) => n.toLocaleString("ko-KR");

export default async function DayReceiptPage(props: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ new?: string; edited?: string; view?: string }>;
}) {
  const user = await requireMerchant();
  if (needsOnboarding(user)) redirect("/onboarding");
  const { date: rawDate } = await props.params;
  const { new: isNew, edited, view } = await props.searchParams;
  const day = normalizeDateStr(rawDate);
  // 발주창 키 K 기준으로 묶는다 — 주말 토·일은 한 창(토요일). 일요일 주소는 토요일 주소로.
  // (하루 수정 화면·하루 수정 저장과 같은 묶음: windowKey=K 또는 레거시 null+createdAt 범위. 취소분도 보여 줌)
  const date = normalizeWindowKey(day);
  if (date !== day) {
    const q = new URLSearchParams();
    if (isNew) q.set("new", isNew);
    if (edited) q.set("edited", edited);
    if (view) q.set("view", view);
    const qs = q.toString();
    redirect(`/order/day/${date}${qs ? `?${qs}` : ""}`);
  }
  const { start, end } = windowCreatedRange(date);
  const currentKey = windowKeyAt();
  const isPastDay = date < currentKey;
  const isWeekendWindow = dowOf(date) === 6;

  const [orders, invoice] = await Promise.all([
    prisma.order.findMany({
      where: {
        userId: user.id,
        OR: [{ windowKey: date }, { windowKey: null, createdAt: { gte: start, lt: end } }],
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invoice.findFirst({
      // 이 날짜의 일반 입금요청서만(사다드림 등 별도 트랙 제외) — 현재 뷰는 비활성이나 재활성 대비 방어.
      where: { userId: user.id, date, kind: "DAILY", status: { in: ["ISSUED", "PAID"] } },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    }),
  ]);
  if (orders.length === 0) notFound();

  const allCancelled = orders.every((o) => o.status === "CANCELLED");

  const sorted = [...orders].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category as Category) -
      CATEGORY_ORDER.indexOf(b.category as Category),
  );
  // 통합 '발주 수정' 진입 가능 여부 — 이 화면이 이번 발주창이고 지금 발주 시간이면(핫딜마켓만).
  // 시간 판정은 하루 수정 화면과 같은 기준(운영시간·강제오픈·지점 '시간 1회 열기').
  const canEditDay =
    hasOrderWindow(user.role) &&
    !allCancelled &&
    date === currentKey &&
    orders.some((o) => o.status !== "CANCELLED") &&
    isOrderOpen() && // 수정은 정규 발주 시간에만(저장 쪽과 같은 기준)
    (await orderTimeOpenForUser(user));

  // 계산서(입금요청서) 조회는 통합 페이지(/invoices)로 일원화 — 이 화면엔 발주 목록만.
  const showInvoiceTab = false;
  const activeView = "orders" as "orders" | "invoice";

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
        {allCancelled && (
          <div className="notice notice--error" style={{ marginBottom: 14 }}>
            <b>취소 완료</b> · 발주가 취소되었습니다.
          </div>
        )}

        {showInvoiceTab && (
          <div className="cattabs cattabs--seg" style={{ marginBottom: 16 }}>
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
                아래 금액을 입금해주세요. 입금이 확인되면 완료로 표시됩니다.
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
                      <span className="invline__amt">{fmt(it.amount)}원</span>
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
              <div className="row__sub" style={{ marginTop: 4 }}>
                발주 {labelDate(date)}
                {isWeekendWindow ? ` ~ ${labelDate(shiftDate(date, 1))}` : ""} · 출고{" "}
                {labelDate(shipmentDayOf(date))}
              </div>
            </div>
            {canEditDay && (
              <div style={{ marginBottom: 20 }}>
                <Link
                  href={`/order/day/${date}/edit`}
                  className="btn btn--primary btn--block"
                >
                  발주 수정
                </Link>
              </div>
            )}
            {sorted.map((order) => {
            const cat = CATEGORIES[order.category as Category];
            return (
              <div key={order.id} style={{ marginBottom: 22 }}>
                <div className="spread" style={{ marginBottom: 8 }}>
                  <span className="chip">{cat.label}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {order.status === "CANCELLED" ? (
                      <span className="badge badge--danger">취소 완료</span>
                    ) : isPastDay ? (
                      <span className="badge badge--ok">완료</span>
                    ) : order.confirmed ? (
                      <span className="badge badge--ok">확인됨 · 준비 중</span>
                    ) : null}
                  </div>
                </div>
                <ReceiptCard
                  storeName={user.storeName}
                  phone={user.phone}
                  categoryLabel={cat.label}
                  vendorLabel={cat.vendorLabel}
                  dateText={formatKDateTime(order.createdAt)}
                  pickupTime={order.pickupTime}
                  fulfillment={order.fulfillment}
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
          <div style={{ marginTop: 8 }}>
            <PrintButton />
          </div>
          </>
        )}
      </div>
    </>
  );
}
