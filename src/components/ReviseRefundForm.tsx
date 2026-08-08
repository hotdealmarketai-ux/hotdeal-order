"use client";

import { useRef, useState, useTransition } from "react";
import { reviseRefundInvoiceAction } from "@/app/actions/refund";
import { MoneyInput } from "./MoneyInput";

const won = (n: number) => n.toLocaleString("ko-KR");
type Row = { id: number; name: string; qty: string; unitPrice: string };

const rowAmount = (r: Row) => {
  const q = parseFloat(r.qty.replace(/[^\d.]/g, "")) || 0;
  const p = parseInt(r.unitPrice.replace(/[^\d]/g, ""), 10) || 0;
  return Math.round(q * p);
};
const isFilled = (r: Row) => !!(r.name.trim() || r.qty.trim() || r.unitPrice.trim());

export type RefundEditItem = { name: string; qty: number; unitPrice: number };

// 환불계산서 제자리 수정 — '환불계산서 수정' 버튼 → 편집 → 확인 → 재발송.
// 발행 폼(RefundInvoiceForm)과 같은 자유입력 UI. 같은 계산서(id)를 갱신하고 점주에게 수정 알림이 간다.
export function ReviseRefundForm({
  invoiceId,
  storeName,
  defaultDate,
  initialItems,
}: {
  invoiceId: string;
  storeName: string;
  defaultDate: string;
  initialItems: RefundEditItem[];
}) {
  const uid = useRef(0);
  const newRow = (): Row => ({ id: ++uid.current, name: "", qty: "", unitPrice: "" });
  const seedRows = (): Row[] => {
    const rows = initialItems.map((it) => ({
      id: ++uid.current,
      name: it.name,
      qty: String(it.qty),
      unitPrice: String(it.unitPrice),
    }));
    rows.push(newRow());
    return rows;
  };

  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [rows, setRows] = useState<Row[]>(seedRows);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const total = rows.reduce((n, r) => n + rowAmount(r), 0);

  const setField = (id: number, k: keyof Row, v: string) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, [k]: v } : r));
      const last = next[next.length - 1];
      if (!last || isFilled(last)) next.push(newRow());
      return next;
    });
  };
  const remove = (id: number) => {
    setRows((prev) => {
      const kept = prev.filter((r) => r.id !== id);
      const last = kept[kept.length - 1];
      if (!last || isFilled(last)) kept.push(newRow());
      return kept;
    });
  };

  const submit = () => {
    setErr("");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr("날짜를 확인하세요.");
    const items = rows
      .filter(isFilled)
      .map((r) => ({
        name: r.name.trim(),
        qty: parseFloat(r.qty.replace(/[^\d.]/g, "")) || 0,
        unitPrice: parseInt(r.unitPrice.replace(/[^\d]/g, ""), 10) || 0,
      }));
    if (items.length === 0) return setErr("환불 품목을 한 개 이상 입력하세요.");
    if (items.some((it) => !it.name || it.qty <= 0 || it.unitPrice <= 0)) {
      return setErr("품목·수량·단가를 정확히 입력하세요.");
    }
    if (
      !confirm(
        `${storeName} 환불계산서를 환불 총액 ${won(total)}원으로 수정해서 다시 발행할까요?\n점주에게 '환불계산서가 수정되었습니다' 알림이 가고, 미수 차감액이 이 금액으로 조정됩니다.`,
      )
    )
      return;
    start(async () => {
      const fd = new FormData();
      fd.set("invoiceId", invoiceId);
      fd.set("date", date);
      fd.set("items", JSON.stringify(items));
      const r = await reviseRefundInvoiceAction(fd);
      if (r?.error) setErr(r.error); // 성공 시 서버가 계산서로 리다이렉트
    });
  };

  if (!editing) {
    return (
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => setEditing(true)}
        >
          환불계산서 수정
        </button>
      </div>
    );
  }

  return (
    <div className="refundform" style={{ marginTop: 16 }}>
      <div className="notice notice--ai" style={{ marginBottom: 12 }}>
        환불계산서를 수정하는 중이에요. 다 고치면 아래 &lsquo;수정해서 다시 발행&rsquo;을 눌러 주세요.
      </div>

      <label className="resvflat__flabel">환불 일자</label>
      <input
        className="input"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      <div className="section-label" style={{ marginBottom: 6 }}>
        환불 품목
      </div>
      <div className="rfrow rfrow--head">
        <span>품목</span>
        <span>수량</span>
        <span>단가</span>
        <span className="rfrow__amt">금액</span>
        <span />
      </div>
      {rows.map((r) => {
        const amt = rowAmount(r);
        return (
          <div className="rfrow" key={r.id}>
            <input
              className="input"
              value={r.name}
              onChange={(e) => setField(r.id, "name", e.target.value)}
              placeholder="품목"
            />
            <input
              className="input"
              inputMode="decimal"
              value={r.qty}
              onChange={(e) => setField(r.id, "qty", e.target.value)}
              placeholder="수량"
            />
            <MoneyInput
              value={r.unitPrice}
              onChange={(raw) => setField(r.id, "unitPrice", raw)}
              placeholder="단가"
            />
            <span className="rfrow__amt">{amt > 0 ? won(amt) : ""}</span>
            {isFilled(r) && (
              <button
                type="button"
                className="invrow__x"
                onClick={() => remove(r.id)}
                aria-label="이 품목 지우기"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}

      <div className="refundform__total">
        <span>환불 총액</span>
        <b>{won(total)}원</b>
      </div>

      {err && (
        <div className="notice notice--error" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}

      <div className="confirm__actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setEditing(false);
            setErr("");
          }}
          disabled={pending}
        >
          그만두기
        </button>
        <button
          type="button"
          className="btn btn--primary"
          style={{ flex: 1.4 }}
          onClick={submit}
          disabled={pending || total <= 0}
        >
          {pending ? "발행 중…" : `수정해서 다시 발행 (${won(total)}원)`}
        </button>
      </div>
    </div>
  );
}
