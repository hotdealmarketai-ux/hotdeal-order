// 본사 출고 지점 발주서 본문(영수증 인쇄 대상). 지점 발주서 화면 + 전체 발주서 인쇄 공용.
import { sumQty } from "@/lib/qty";
import { labelDate } from "@/lib/date";
import { boxWord } from "@/lib/weekly-catalog";
import type { ReceiptLine } from "@/lib/vendor-receipt";
import type { WeeklyShipItem } from "@/lib/weekly";

function Section({ label, lines }: { label: string; lines: ReceiptLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="invcat">
      <div className="invcat__head">
        <span className="chip">{label}</span>
        <span className="invcat__sum">총 {sumQty(lines.map((l) => l.qty))}개</span>
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

export function VendorStoreReceipt({
  storeName,
  phone,
  address,
  date,
  toolLines,
  tofuLines,
  weekly,
}: {
  storeName: string;
  phone: string | null;
  address: string | null;
  date: string;
  toolLines: ReceiptLine[];
  tofuLines: ReceiptLine[];
  weekly: WeeklyShipItem[];
}) {
  return (
    <div className="receipt">
      <div className="card card--flat" style={{ marginBottom: 14 }}>
        <div className="receipt__store">{storeName}</div>
        <div className="receipt__meta" style={{ marginTop: 4 }}>
          출고 {labelDate(date)}
        </div>
        <div className="kv" style={{ marginTop: 10 }}>
          <span className="kv__k">연락처</span>
          <span className="kv__v">{phone}</span>
        </div>
        <div className="kv">
          <span className="kv__k">주소</span>
          <span className="kv__v">{address}</span>
        </div>
      </div>

      <Section label="공구" lines={toolLines} />
      <Section label="채움채" lines={tofuLines} />

      {weekly.length > 0 && (
        <div className="invcat">
          <div className="invcat__head">
            <span className="chip">주간발주</span>
            <span className="invcat__sum">{weekly.length}개 품목</span>
          </div>
          {weekly.map((w, i) => (
            <div className="invline" key={i}>
              <span>
                <span className="receipt-item__no">{i + 1}</span>
                {w.name}
              </span>
              <span className="invline__amt">
                {w.qty}
                {boxWord(w.category)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
