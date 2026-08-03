import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { listFlatProductsAdmin } from "@/lib/reservation-flat";
import { formatKDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

// 지난 예약 마감 — 마감 시각이 지난 신규 예약상품. 카드를 열면 점포별 취합 상세(진행 중과 동일).
export default async function ClosedReservationsPage() {
  await requireAdmin();
  const products = await listFlatProductsAdmin("closed");

  return (
    <>
      <Topbar backHref="/admin/reservations" title="지난 예약 마감" />
      <div className="page">
        <div className="itemshead">
          <span className="itemshead__label">마감된 예약상품</span>
          <span className="itemshead__count">{products.length}개</span>
        </div>

        {products.length === 0 ? (
          <div className="empty">
            <p>마감된 예약상품이 없어요.</p>
          </div>
        ) : (
          <div className="resvflatwrap">
            {products.map((p) => (
              <div className="resvflat" key={p.id}>
                <Link
                  href={`/admin/reservations/product/${p.id}`}
                  className="resvflat__main"
                >
                  <div className="resvflat__name">
                    {p.name}
                    {p.inventoryItemId ? (
                      <span className="resvflat__tag">재고연동</span>
                    ) : null}
                  </div>
                  <div className="resvflat__meta">
                    픽업 {p.pickupDate} · 공급가 {won(p.supplyPrice)}원
                  </div>
                  <div className="resvflat__meta2">
                    <span className="resvflat__cd resvflat__cd--closed">
                      {formatKDateTime(p.closeAt)} 마감
                    </span>
                    <span className="resvflat__agg">
                      총 {p.totalQty}개 · {p.storeCount}점포 ›
                    </span>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
