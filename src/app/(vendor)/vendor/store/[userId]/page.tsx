import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
import { requireVendor } from "@/lib/session";
import { normalizeDateStr } from "@/lib/date";
import { buildStoreReceipt } from "@/lib/vendor-receipt";
import { VendorStoreReceipt } from "@/components/vendor/VendorStoreReceipt";
import { confirmStoreShipmentAction } from "@/app/actions/vendor";
import { PrintButton } from "@/components/PrintButton";

// 본사 출고 통합 발주서(N3) — 한 지점의 공구(ADMIN_SAEROP)+채움채(VENDOR_CHAEUMCHAE)+공구예약분+주간발주를
// 하나의 발주서로. 발주 확인 + 영수증 인쇄(발주서 인쇄).
export default async function VendorStorePage(props: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireVendor();
  if (user.role !== "ADMIN_SAEROP") notFound(); // 본사 출고 전용

  const { userId } = await props.params;
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);

  const { merchant, orders, reservedCount, toolLines, tofuLines, weekly } =
    await buildStoreReceipt(userId, date);
  if (!merchant) notFound();
  if (orders.length === 0 && reservedCount === 0 && weekly.length === 0) notFound();

  const allConfirmed = orders.length > 0 && orders.every((o) => o.confirmed);
  const edited = orders.some((o) => o.edited && !o.confirmed);

  return (
    <>
      <Topbar backHref={`/vendor?date=${date}`} title="발주서" />
      <div className="page">
        {edited ? (
          <div className="notice notice--edit" style={{ marginBottom: 14 }}>
            발주 수정 — 점주가 발주를 수정했어요. 내용 확인 후 다시 발주 확인을 눌러주세요.
          </div>
        ) : null}

        {/* 발주 확인/취소 — 인쇄 대상 아님 */}
        {orders.length > 0 && (
          <div className="no-print">
            {allConfirmed ? (
              <div
                className="card card--flat"
                style={{
                  marginBottom: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span className="badge badge--ok">발주 확인됨</span>
                <form action={confirmStoreShipmentAction}>
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="date" value={date} />
                  <input type="hidden" name="next" value="false" />
                  <button className="linkbtn">확인 취소</button>
                </form>
              </div>
            ) : (
              <form action={confirmStoreShipmentAction} style={{ marginBottom: 14 }}>
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="next" value="true" />
                <button className="btn btn--primary">발주 확인</button>
              </form>
            )}
          </div>
        )}

        {/* 발주서 본문 — 영수증 인쇄 대상(80mm) */}
        <VendorStoreReceipt
          storeName={merchant.storeName}
          phone={merchant.phone}
          address={merchant.address}
          date={date}
          toolLines={toolLines}
          tofuLines={tofuLines}
          weekly={weekly}
        />

        <div className="no-print" style={{ marginTop: 14 }}>
          <PrintButton label="발주서 인쇄" />
        </div>
      </div>
    </>
  );
}
