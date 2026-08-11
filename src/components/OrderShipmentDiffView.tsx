"use client";

import { useState } from "react";
import type { OrderShipmentDiff, CatDiff, DiffRow } from "@/lib/order-shipment-diff";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const CATS: { key: keyof CatDiff; label: string }[] = [
  { key: "tool", label: "공구" },
  { key: "tofu", label: "채움채" },
  { key: "weekly", label: "주간발주" },
];

// 발주↔출고 대조 뷰(읽기 전용) — 총합/지점별 토글. 발주≠계산서(재고 튐)인 품목만 표시.
//  diff = 발주 − 계산서. >0 = 발주했는데 출고(계산서) 안 됨/부족(빨강), <0 = 계산서에만 더 잡힘(파랑).
export function OrderShipmentDiffView({ data }: { data: OrderShipmentDiff }) {
  const [view, setView] = useState<"total" | "store">("total");

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="spread">
          <span className="row__sub">
            대상 지점 {data.storeCount}곳
            {data.mismatchStoreCount > 0 ? ` · 튄 지점 ${data.mismatchStoreCount}곳` : ""}
          </span>
          <b style={{ color: data.totalMismatch > 0 ? "var(--danger)" : "inherit" }}>
            {data.totalMismatch > 0 ? `튄 품목 ${data.totalMismatch}` : "이상 없음"}
          </b>
        </div>
        {data.totalMismatch > 0 && (
          <div className="row__sub" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)", lineHeight: 1.6 }}>
            <b style={{ color: "var(--danger)" }}>부족</b> = 발주보다 출고 완료가 적음(발주했는데 안 나감) ·{" "}
            <b style={{ color: "#2563eb" }}>초과</b> = 발주보다 출고 완료가 많음(발주보다 더 나감)
          </div>
        )}
      </div>

      <div className="modetoggle" style={{ justifyContent: "flex-start", gap: 8 }}>
        {(["total", "store"] as const).map((v) => {
          const on = view === v;
          return (
            <button
              key={v}
              type="button"
              className="modetoggle__btn"
              style={on ? { background: "var(--green-700)", color: "#fff", borderColor: "var(--green-700)" } : {}}
              onClick={() => setView(v)}
            >
              {v === "total" ? "총합" : `지점별${data.mismatchStoreCount > 0 ? ` (${data.mismatchStoreCount})` : ""}`}
            </button>
          );
        })}
      </div>

      {view === "total" ? (
        data.totalMismatch === 0 ? (
          <div className="empty">
            <p>발주와 계산서가 모두 일치해요. 재고 튐 없음.</p>
          </div>
        ) : (
          <CatBlocks diff={data.total} />
        )
      ) : data.byStore.length === 0 ? (
        <div className="empty">
          <p>어긋난 지점이 없어요.</p>
        </div>
      ) : (
        data.byStore.map((s) => (
          <div key={s.userId} style={{ marginBottom: 20 }}>
            <div className="section-label spread">
              <span>{s.storeName}</span>
              <span style={{ color: "var(--danger)" }}>튄 품목 {s.mismatchCount}</span>
            </div>
            <CatBlocks diff={s} />
          </div>
        ))
      )}
    </>
  );
}

function CatBlocks({ diff }: { diff: CatDiff }) {
  return (
    <>
      {CATS.map(({ key, label }) => {
        const rows = diff[key];
        if (rows.length === 0) return null;
        return <CatTable key={key} label={label} rows={rows} />;
      })}
    </>
  );
}

function CatTable({ label, rows }: { label: string; rows: DiffRow[] }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="section-label">{label}</div>
      <div className="rectable">
        <div className="rectable__head">
          <span className="rectable__name">품목</span>
          <span className="rectable__num">실제 발주</span>
          <span className="rectable__num">출고 완료</span>
          <span className="rectable__num">차이</span>
        </div>
        {rows.map((r) => {
          const short = r.diff > 0; // 실제 발주 > 출고 완료 = 출고 부족(빨강)
          return (
            <div className="rectable__row" key={r.name}>
              <span className="rectable__name">{r.name}</span>
              <span className="rectable__num">{fmt(r.ordered)}</span>
              <span className="rectable__num">{fmt(r.invoiced)}</span>
              <span
                className="rectable__num"
                style={{
                  color: short ? "var(--danger)" : "#2563eb",
                  fontWeight: 700,
                }}
              >
                {short ? "부족 " : "초과 "}
                {fmt(Math.abs(r.diff))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
