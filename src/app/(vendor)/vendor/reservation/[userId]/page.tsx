import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
import { requireVendor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { labelDate, normalizeDateStr } from "@/lib/date";
import { getReservationItemsForStorePickup } from "@/lib/reservation-data";

// 공구 벤더(새롭) — 공구 담기 발주 없이 '예약분만' 있는 점포의 발주서.
// /vendor 목록의 '예약' 행에서 진입. 픽업일(=출고일)의 확정 예약분을 보여준다.
export default async function VendorReservationReceipt(props: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireVendor();
  if (user.role !== "ADMIN_SAEROP") notFound();
  const { userId } = await props.params;
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);

  const store = await prisma.user.findUnique({
    where: { id: userId },
    select: { storeName: true, phone: true, address: true },
  });
  if (!store) notFound();
  const items = await getReservationItemsForStorePickup(userId, date);

  return (
    <>
      <Topbar backHref={`/vendor?date=${date}`} title="예약 발주서" />
      <div className="page">
        <div className="card card--flat" style={{ marginBottom: 14 }}>
          <div className="kv">
            <span className="kv__k">상호명</span>
            <span className="kv__v">{store.storeName}</span>
          </div>
          <div className="kv">
            <span className="kv__k">연락처</span>
            <span className="kv__v">{store.phone}</span>
          </div>
          <div className="kv">
            <span className="kv__k">주소</span>
            <span className="kv__v">{store.address}</span>
          </div>
        </div>

        <div className="receipt" id="receipt-print">
          <div className="receipt__head">
            <div className="receipt__store">{store.storeName}</div>
            <div
              className="receipt__meta"
              style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}
            >
              <span className="badge badge--mute">출고 {labelDate(date)}</span>
              <span className="badge badge--ai">예약분</span>
            </div>
          </div>
          <div className="receipt__section">
            <div className="section-label" style={{ margin: "0 0 8px" }}>
              공구 · 예약분
            </div>
            {items.length === 0 ? (
              <div className="receipt-item">
                <div className="receipt-item__name muted">예약 품목이 없어요.</div>
              </div>
            ) : (
              items.map((it, i) => (
                <div className="receipt-item" key={i}>
                  <div className="receipt-item__name">{it.name}</div>
                  <div className="receipt-item__qty">{it.qty}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
