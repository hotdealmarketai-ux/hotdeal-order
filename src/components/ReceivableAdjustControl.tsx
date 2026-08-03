"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustReceivableAction } from "@/app/actions/deposit";
import { MoneyInput } from "./MoneyInput";

// 미수 수동 조정(관리자 전용) — 미수를 늘리거나 줄인다. 사유 필수. 저장 후 조정 내역에 남는다.
export function ReceivableAdjustControl({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<"plus" | "minus">("minus");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const close = () => {
    setOpen(false);
    setAmount("");
    setMemo("");
    setDir("minus");
    setErr("");
  };

  const submit = () => {
    setErr("");
    start(async () => {
      const fd = new FormData();
      fd.set("userId", userId);
      fd.set("direction", dir);
      fd.set("amount", amount);
      fd.set("memo", memo);
      const res = await adjustReceivableAction(fd);
      if (res?.error) {
        setErr(res.error);
        return;
      }
      close();
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn--soft btn--block"
        style={{ marginBottom: 16 }}
        onClick={() => setOpen(true)}
      >
        미수 조정
      </button>
    );
  }

  return (
    <div className="card radj" style={{ marginBottom: 16 }}>
      <div className="radj__dir">
        <button
          type="button"
          className={`radj__diropt ${dir === "minus" ? "is-on is-minus" : ""}`}
          onClick={() => setDir("minus")}
        >
          미수 줄이기 (−)
        </button>
        <button
          type="button"
          className={`radj__diropt ${dir === "plus" ? "is-on is-plus" : ""}`}
          onClick={() => setDir("plus")}
        >
          미수 늘리기 (+)
        </button>
      </div>
      <MoneyInput value={amount} onChange={setAmount} placeholder="금액" />
      <input
        className="input"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="사유 (예: 입금 누락 정정, 반품 차감)"
        maxLength={200}
        style={{ marginTop: 8 }}
      />
      {err && (
        <div className="notice notice--error" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
      <div className="confirm__actions" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn--xs btn--ghost" onClick={close}>
          취소
        </button>
        <button
          type="button"
          className="btn btn--xs btn--primary"
          disabled={pending}
          onClick={submit}
        >
          {pending ? "저장 중…" : "조정 저장"}
        </button>
      </div>
    </div>
  );
}
