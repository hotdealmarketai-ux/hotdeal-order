import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canOrderWeekly } from "@/lib/constants";
import { WEEKLY_CLOSE_LABEL } from "@/lib/schedule";
import { labelDateLong } from "@/lib/date";
import {
  weeklyKeyAt,
  weeklyLockOf,
  weeklyReceivableOf,
  weeklyOpenNow,
  weeklyForceOpen,
  getWeeklyProducts,
  weeklyStatusOf,
} from "@/lib/weekly";
import { WeeklyOrderForm } from "@/components/WeeklyOrderForm";
import { WeeklyReceipt } from "@/components/WeeklyReceipt";
import { WeeklyDeadlineCountdown } from "@/components/WeeklyDeadlineCountdown";
import { CancelWeeklyOrderButton } from "@/components/CancelWeeklyOrderButton";

const won = (n: number) => n.toLocaleString("ko-KR");

function Header({
  storeName,
  forceOpen,
}: {
  storeName: string;
  forceOpen: boolean;
}) {
  return (
    <Topbar
      brand="핫딜오더"
      right={<TopbarChip>{storeName}</TopbarChip>}
    >
      <WeeklyDeadlineCountdown closeLabel={WEEKLY_CLOSE_LABEL} forceOpen={forceOpen} />
    </Topbar>
  );
}

export default async function WeeklyOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; edit?: string; ok?: string; cancelled?: string; err?: string }>;
}) {
  const user = await requireMerchant();
  if (!canOrderWeekly(user.role)) redirect("/order");

  const sp = await searchParams;
  const open = await weeklyOpenNow();
  const forceOpen = await weeklyForceOpen();
  const currentWeek = weeklyKeyAt();
  const selWeek = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : currentWeek;
  const isCurrent = selWeek === currentWeek;

  const order = await prisma.weeklyOrder.findUnique({
    where: { userId_weekKey: { userId: user.id, weekKey: selWeek } },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });

  // 닫힌 시간 + 이번 주 발주 없음 → 기능 전부 감추고 안내만 가운데에
  if (!open && isCurrent && !order) {
    return (
      <>
        <Header storeName={user.storeName} forceOpen={forceOpen} />
        <div
          className="page"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            minHeight: "62vh",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--fg)" }}>
            지금은 주간발주 시간이 아닙니다.
          </div>
          <div style={{ height: 18 }} />
          <div style={{ color: "var(--muted)", lineHeight: 1.6 }}>
            매주 토요일 12:00 ~ 20:00
          </div>
        </div>
      </>
    );
  }

  const editMode = sp.edit === "1" && open && isCurrent;
  const needForm = editMode || (isCurrent && open && !order);

  const [products, lock, receivable, invoice, historyRows] = await Promise.all([
    needForm ? getWeeklyProducts() : Promise.resolve([]),
    weeklyLockOf(user.id, user.weeklyOrderUnlock, user.weeklyOrderUnlockAt),
    weeklyReceivableOf(user.id),
    prisma.invoice.findFirst({
      where: { userId: user.id, kind: "WEEKLY", date: selWeek, status: { not: "VOID" } },
      select: { status: true },
    }),
    prisma.weeklyOrder.findMany({
      where: { userId: user.id },
      select: { weekKey: true },
      orderBy: { weekKey: "desc" },
      take: 12,
    }),
  ]);

  const weeks = [...new Set([currentWeek, ...historyRows.map((h) => h.weekKey)])];
  const status = weeklyStatusOf(order, invoice);
  const initialQty: Record<string, string> = {};
  for (const it of order?.items ?? []) initialQty[it.code] = String(it.qty);
  const receiptItems = (order?.items ?? []).map((it) => ({
    category: it.category,
    name: it.name,
    sub: `${it.qty}박스 × ${won(it.unitPrice)}`,
    amount: it.qty * it.unitPrice,
  }));

  return (
    <>
      <Header storeName={user.storeName} forceOpen={forceOpen} />
      <div className="page">
        <h1 className="h1" style={{ marginBottom: 20 }}>주간발주</h1>

        {sp.ok === "1" && (
          <div className="notice notice--ok" style={{ marginBottom: 12 }}>
            발주가 완료되었습니다.
          </div>
        )}
        {sp.cancelled === "1" && (
          <div className="notice notice--mute" style={{ marginBottom: 12 }}>
            주간발주가 취소되었어요.
          </div>
        )}
        {sp.err === "invoiced" && (
          <div className="notice notice--error" style={{ marginBottom: 12 }}>
            입금요청서가 이미 발행되어 취소할 수 없어요. 새롭에 문의해 주세요.
          </div>
        )}

        <Link
          href="/weekly/invoices"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            margin: "0 0 16px",
            padding: "17px 18px",
            minHeight: 58,
            background: "var(--green-800)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-pill)",
            textDecoration: "none",
          }}
        >
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>
            주간발주 입금요청서{receivable.count > 0 ? ` · 미입금 ${receivable.count}건` : ""}
          </span>
          <span
            style={{
              fontWeight: 800,
              fontSize: 15,
              whiteSpace: "nowrap",
              color: receivable.balance > 0 ? "#ffd98a" : "rgba(255,255,255,0.92)",
            }}
          >
            {receivable.balance > 0 ? `${won(receivable.balance)}원 ›` : "보기 ›"}
          </span>
        </Link>

        {/* 주 선택(달력식 히스토리) */}
        {weeks.length > 1 && (
          <div
            style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 12 }}
          >
            {weeks.map((w) => (
              <Link
                key={w}
                href={`/weekly?date=${w}`}
                className="chip"
                style={{
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  ...(w === selWeek
                    ? { background: "var(--green-700)", color: "#fff", borderColor: "transparent" }
                    : {}),
                }}
              >
                {labelDateLong(w)}
              </Link>
            ))}
          </div>
        )}

        {editMode ? (
          <>
            <div className="notice notice--mute" style={{ marginBottom: 12 }}>
              주간발주를 수정 중이에요. 저장하면 다시 접수됩니다.
            </div>
            <WeeklyOrderForm
              products={products}
              initialQty={initialQty}
              submitLabel="수정 완료"
            />
          </>
        ) : order ? (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <span style={{ fontWeight: 700 }}>{labelDateLong(selWeek)} 주간발주</span>
              <span className={`badge ${status.cls}`}>{status.label}</span>
            </div>
            <WeeklyReceipt items={receiptItems} />
            {open && isCurrent && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <Link href="/weekly?edit=1" className="btn btn--primary btn--block">
                  수정하러 가기
                </Link>
                {(!invoice || invoice.status === "DRAFT") && <CancelWeeklyOrderButton />}
              </div>
            )}
          </>
        ) : isCurrent && open ? (
          lock.locked ? (
            <div className="notice notice--error">
              <b>지난 주간발주 입금이 확인되지 않았습니다. 입금 부탁드립니다.</b>
              <br />
              입금이 확인되면 주간발주가 다시 열려요. (급하면 새롭에 문의)
            </div>
          ) : (
            <WeeklyOrderForm products={products} />
          )
        ) : (
          <div className="notice notice--mute">이 주엔 주간발주가 없어요.</div>
        )}
      </div>
    </>
  );
}
