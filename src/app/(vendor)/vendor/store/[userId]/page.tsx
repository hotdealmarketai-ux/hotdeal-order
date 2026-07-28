import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
import { requireVendor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { displayQty, sumQty } from "@/lib/qty";
import {
  normalizeDateStr,
  labelDate,
  orderRangeForShipment,
} from "@/lib/date";
import { getReservationItemsForStorePickup } from "@/lib/reservation-data";
import { confirmStoreShipmentAction } from "@/app/actions/vendor";

type Line = { name: string; qty: string; note: string; tag?: string };

function Section({ label, lines }: { label: string; lines: Line[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="invcat">
      <div className="invcat__head">
        <span className="chip">{label}</span>
        <span className="invcat__sum">
          총 {sumQty(lines.map((l) => l.qty))}개
        </span>
      </div>
      {lines.map((l, i) => (
        <div className="invline" key={i}>
          <span>
            <span className="receipt-item__no">{i + 1}</span>
            {l.name}
            {l.tag ? <span className="receipt-tag">{l.tag}</span> : null}
            {l.note ? <span className="invline__meta">{l.note}</span> : null}
          </span>
          <span className="invline__amt">{l.qty}</span>
        </div>
      ))}
    </div>
  );
}

// 본사 출고 통합 발주서(N3) — 한 지점의 공구(ADMIN_SAEROP)+채움채(VENDOR_CHAEUMCHAE)+공구예약분을
// 하나의 발주서로. 공구/채움채를 한 번에 발주 확인.
export default async function VendorStorePage(props: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireVendor();
  if (user.role !== "ADMIN_SAEROP") notFound(); // 본사 출고 전용

  const { userId } = await props.params;
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);
  const { start, end } = orderRangeForShipment(date);

  const [merchant, orders, reserved] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { storeName: true, phone: true, address: true },
    }),
    prisma.order.findMany({
      where: {
        userId,
        vendorRole: { in: ["ADMIN_SAEROP", "VENDOR_CHAEUMCHAE"] },
        createdAt: { gte: start, lt: end },
        status: { not: "CANCELLED" },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    getReservationItemsForStorePickup(userId, date),
  ]);
  if (!merchant) notFound();
  if (orders.length === 0 && reserved.length === 0) notFound();

  const toLine = (it: {
    name: string;
    rawName: string;
    qty: string;
    rawQty: string;
    note: string;
    rawNote: string;
  }): Line => ({
    name: it.name || it.rawName,
    qty: it.qty || displayQty(it.rawQty),
    note: it.note || it.rawNote,
  });

  // 공구(새롭 본사) = ADMIN_SAEROP 발주 품목 + 확정 예약분
  const toolLines: Line[] = [
    ...orders
      .filter((o) => o.vendorRole === "ADMIN_SAEROP")
      .flatMap((o) => o.items.map(toLine)),
    ...reserved.map((r) => ({ name: r.name, qty: String(r.qty), note: "", tag: "예약" })),
  ];
  // 채움채 = VENDOR_CHAEUMCHAE 발주 품목
  const tofuLines: Line[] = orders
    .filter((o) => o.vendorRole === "VENDOR_CHAEUMCHAE")
    .flatMap((o) => o.items.map(toLine));

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

        {orders.length > 0 &&
          (allConfirmed ? (
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
          ))}

        <div className="card card--flat" style={{ marginBottom: 14 }}>
          <div className="receipt__store">{merchant.storeName}</div>
          <div className="receipt__meta" style={{ marginTop: 4 }}>
            출고 {labelDate(date)}
          </div>
          <div className="kv" style={{ marginTop: 10 }}>
            <span className="kv__k">연락처</span>
            <span className="kv__v">{merchant.phone}</span>
          </div>
          <div className="kv">
            <span className="kv__k">주소</span>
            <span className="kv__v">{merchant.address}</span>
          </div>
        </div>

        <Section label="공구" lines={toolLines} />
        <Section label="채움채" lines={tofuLines} />
      </div>
    </>
  );
}
