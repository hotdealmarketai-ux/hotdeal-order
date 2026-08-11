"use client";

import { useRef, useState, useTransition } from "react";
import {
  issueSadadreamInvoiceAction,
  reviseSadadreamInvoiceAction,
} from "@/app/actions/sadadream";
import { MoneyInput } from "./MoneyInput";

const won = (n: number) => n.toLocaleString("ko-KR");
type Row = { id: number; name: string; qty: string; unitPrice: string };

function dateLabel(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "long",
      day: "numeric",
      weekday: "short",
      timeZone: "Asia/Seoul",
    }).format(new Date(`${d}T00:00:00+09:00`));
  } catch {
    return d;
  }
}
const rowAmount = (r: Row) => {
  const q = parseFloat(r.qty.replace(/[^\d.]/g, "")) || 0;
  const p = parseInt(r.unitPrice.replace(/[^\d]/g, ""), 10) || 0;
  return Math.round(q * p);
};
const isFilled = (r: Row) => !!(r.name.trim() || r.qty.trim() || r.unitPrice.trim());

export type SadadreamInitial = {
  invoiceId: string;
  date: string;
  bank: string;
  holder: string;
  account: string;
  items: { name: string; qty: number; unitPrice: number }[];
};

// 사다드림 계산서 작성 — 맨 위 입금계좌(은행/예금주/계좌번호) + 품목/수량/단가 자유 입력.
// invoiceId(initial) 있으면 '수정·재발송' 모드, 없으면 '발행' 모드.
export function SadadreamInvoiceForm({
  userId,
  storeName,
  defaultDate,
  initial,
}: {
  userId: string;
  storeName: string;
  defaultDate: string;
  initial?: SadadreamInitial;
}) {
  const editing = !!initial;
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [bank, setBank] = useState(initial?.bank ?? "");
  const [holder, setHolder] = useState(initial?.holder ?? "");
  const [account, setAccount] = useState(initial?.account ?? "");
  const uid = useRef(1);
  const [rows, setRows] = useState<Row[]>(
    initial && initial.items.length
      ? initial.items.map((it) => ({
          id: uid.current++,
          name: it.name,
          qty: String(it.qty),
          unitPrice: String(it.unitPrice),
        }))
      : [{ id: 1, name: "", qty: "", unitPrice: "" }],
  );
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const total = rows.reduce((n, r) => n + rowAmount(r), 0);

  const setField = (id: number, k: keyof Row, v: string) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, [k]: v } : r));
      const last = next[next.length - 1];
      if (!last || isFilled(last)) next.push({ id: ++uid.current, name: "", qty: "", unitPrice: "" });
      return next;
    });
  };
  const remove = (id: number) => {
    setRows((prev) => {
      const kept = prev.filter((r) => r.id !== id);
      const last = kept[kept.length - 1];
      if (!last || isFilled(last)) kept.push({ id: ++uid.current, name: "", qty: "", unitPrice: "" });
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
    if (items.length === 0) return setErr("품목을 한 개 이상 입력하세요.");
    if (items.some((it) => !it.name || it.qty <= 0 || it.unitPrice <= 0)) {
      return setErr("품목·수량·단가를 정확히 입력하세요.");
    }
    if (
      !confirm(
        `${storeName}에 사다드림 계산서를 ${won(total)}원으로 ${editing ? "수정·재발송" : "발행"}할까요?`,
      )
    )
      return;
    start(async () => {
      const fd = new FormData();
      fd.set("date", date);
      fd.set("sdBank", bank.trim());
      fd.set("sdHolder", holder.trim());
      fd.set("sdAccount", account.trim());
      fd.set("items", JSON.stringify(items));
      let r: { error?: string } | undefined;
      if (editing) {
        fd.set("invoiceId", initial!.invoiceId);
        r = await reviseSadadreamInvoiceAction(fd);
      } else {
        fd.set("userId", userId);
        r = await issueSadadreamInvoiceAction(fd);
      }
      if (r?.error) setErr(r.error); // 성공 시 서버가 리다이렉트
    });
  };

  return (
    <div className="refundform">
      <div className="refundform__head">
        <div className="refundform__store">{storeName}</div>
        <div className="refundform__sub">{dateLabel(date)} 사다드림 계산서</div>
      </div>

      {/* 입금계좌 — 개인/개인업체 계좌(발행 시점 입력, 계산서에 표기) */}
      <div className="section-label" style={{ marginBottom: 6 }}>
        입금계좌
      </div>
      <div className="stack" style={{ gap: 8, marginBottom: 14 }}>
        <input
          className="input"
          value={bank}
          onChange={(e) => setBank(e.target.value)}
          placeholder="은행"
        />
        <input
          className="input"
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
          placeholder="예금주"
        />
        <input
          className="input"
          inputMode="numeric"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder="계좌번호"
        />
      </div>

      <label className="resvflat__flabel">발행 일자</label>
      <input
        className="input"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      <div className="section-label" style={{ marginBottom: 6 }}>
        품목
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
        <span>합계</span>
        <b>{won(total)}원</b>
      </div>

      {err && (
        <div className="notice notice--error" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}

      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={submit}
        disabled={pending || total <= 0}
        style={{ marginTop: 12 }}
      >
        {pending
          ? editing
            ? "수정 중…"
            : "발행 중…"
          : `사다드림 계산서 ${editing ? "수정·재발송" : "발행"} (${won(total)}원)`}
      </button>
    </div>
  );
}
