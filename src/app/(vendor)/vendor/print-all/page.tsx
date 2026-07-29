import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVendor } from "@/lib/session";
import { normalizeDateStr, labelDate } from "@/lib/date";
import { getVendorStoreList, buildStoreReceipt } from "@/lib/vendor-receipt";
import { VendorStoreReceipt } from "@/components/vendor/VendorStoreReceipt";
import { AutoPrint } from "@/components/vendor/AutoPrint";

export const dynamic = "force-dynamic";

// 본사출고 '전체 발주서 인쇄' — 들어온 모든 지점 발주서를 한 번에, 지점별로 페이지가 끊겨(각각 한 장)
// 영수증 프린터에서 연속 출력. 페이지가 뜨면 AutoPrint가 바로 window.print() 호출.
export default async function VendorPrintAllPage(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireVendor();
  if (user.role !== "ADMIN_SAEROP") notFound(); // 본사 출고 전용

  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);

  const stores = await getVendorStoreList(date);
  const receipts = (
    await Promise.all(
      stores.map(async (s) => ({ s, r: await buildStoreReceipt(s.userId, date) })),
    )
  ).filter(
    ({ r }) =>
      r.merchant &&
      (r.toolLines.length > 0 || r.tofuLines.length > 0 || r.weekly.length > 0),
  );

  return (
    <div className="page">
      {receipts.length > 0 && <AutoPrint />}
      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Link href={`/vendor?date=${date}`} className="btn btn--ghost">
          ← 뒤로
        </Link>
        <span className="hint" style={{ textAlign: "right" }}>
          출고 {labelDate(date)} · {receipts.length}개 지점
        </span>
      </div>

      {receipts.length === 0 ? (
        <div className="empty no-print">
          <p>인쇄할 발주서가 없어요.</p>
        </div>
      ) : (
        receipts.map(({ s, r }) => (
          <div className="print-store" key={s.userId}>
            <VendorStoreReceipt
              storeName={r.merchant!.storeName}
              phone={r.merchant!.phone}
              address={r.merchant!.address}
              date={date}
              toolLines={r.toolLines}
              tofuLines={r.tofuLines}
              weekly={r.weekly}
            />
          </div>
        ))
      )}
    </div>
  );
}
