import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canOrderWeekly } from "@/lib/constants";
import { WEEKLY_OPEN_LABEL, WEEKLY_CLOSE_LABEL } from "@/lib/schedule";
import {
  weeklyKeyAt,
  weeklyLockOf,
  weeklyReceivableOf,
  weeklyOpenNow,
  weeklyPriceMap,
} from "@/lib/weekly";
import { WeeklyOrderForm } from "@/components/WeeklyOrderForm";
import { PushToggle } from "@/components/PushToggle";

export default async function WeeklyOrderPage() {
  const user = await requireMerchant();
  if (!canOrderWeekly(user.role)) redirect("/order");

  const open = await weeklyOpenNow();

  // 닫혀 있으면 — 기능 전부 감추고 안내만 가운데에
  if (!open) {
    return (
      <>
        <Topbar
          brand="핫딜오더"
          right={
            <>
              <TopbarChip>{user.storeName}</TopbarChip>
              <PushToggle variant="header" />
            </>
          }
        />
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
            주간발주 가능시간 - {WEEKLY_OPEN_LABEL} 부터 {WEEKLY_CLOSE_LABEL} 까지
          </div>
        </div>
      </>
    );
  }

  const weekKey = weeklyKeyAt();
  const [lock, receivable, existing, priceMap] = await Promise.all([
    weeklyLockOf(user.id, user.weeklyOrderUnlock, user.weeklyOrderUnlockAt),
    weeklyReceivableOf(user.id),
    prisma.weeklyOrder.findUnique({
      where: { userId_weekKey: { userId: user.id, weekKey } },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    }),
    weeklyPriceMap(),
  ]);

  const initialQty: Record<string, string> = {};
  for (const it of existing?.items ?? []) initialQty[it.code] = String(it.qty);

  return (
    <>
      <Topbar
        brand="핫딜오더"
        right={
          <>
            <TopbarChip>{user.storeName}</TopbarChip>
            <PushToggle variant="header" />
          </>
        }
      />
      <div className="page">
        <h1 className="h1">주간발주</h1>
        <p className="lead">
          이번 주에 쓸 항시품목(과자·유제품·건어물·계란)을 한 번에 발주해요.
        </p>

        <Link
          href="/weekly/invoices"
          className="card"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            margin: "4px 0 16px",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <span style={{ color: "var(--muted)" }}>
            주간발주 입금요청서{receivable.count > 0 ? ` · 미입금 ${receivable.count}건` : ""}
          </span>
          <span style={{ fontWeight: 800, color: "var(--black)" }}>
            {receivable.balance > 0
              ? `${receivable.balance.toLocaleString("ko-KR")}원 ›`
              : "보기 ›"}
          </span>
        </Link>

        {lock.locked ? (
          <div className="notice notice--error" style={{ marginBottom: 16 }}>
            <b>지난 주간발주 입금이 확인되지 않았습니다. 입금 부탁드립니다.</b>
            <br />
            입금이 확인되면 주간발주가 다시 열려요. (급하면 새롭에 문의)
          </div>
        ) : (
          <WeeklyOrderForm initialQty={initialQty} priceByCode={priceMap} />
        )}
      </div>
    </>
  );
}
