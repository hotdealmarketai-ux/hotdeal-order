"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustReceivableAction } from "@/app/actions/deposit";
import { MoneyInput } from "./MoneyInput";

const won = (n: number) => n.toLocaleString("ko-KR");

// 미수 수동 조정(관리자 전용). 기본 잠금 — 1234 비밀번호로 잠금 해제해야 수정 가능.
// 두 모드: '직접 입력'(미수금액을 원하는 숫자로 바로 변경) / '가감(+/−)'(늘리거나 줄이기).
export function ReceivableAdjustControl({
  userId,
  currentBalance,
}: {
  userId: string;
  currentBalance: number;
}) {
  const [open, setOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [mode, setMode] = useState<"set" | "delta">("set");
  const [dir, setDir] = useState<"plus" | "minus">("minus");
  const [amount, setAmount] = useState("");
  // 직접 입력 프리필 — MoneyInput은 숫자만 다루므로 음수(선결제·크레딧)면 0으로 시작한다.
  // (음수를 그대로 넣으면 표시는 부호가 사라져 '현재값'과 어긋나고, 미수정 저장 시 부호가 뒤집힐 수 있음)
  const prefillSet = String(Math.max(0, currentBalance));
  const [setValue, setSetValue] = useState(prefillSet);
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const close = () => {
    setOpen(false);
    setUnlocked(false);
    setPw("");
    setPwErr("");
    setMode("set");
    setDir("minus");
    setAmount("");
    setSetValue(prefillSet);
    setMemo("");
    setErr("");
  };

  const unlock = () => {
    if (pw.trim() !== "1234") {
      setPwErr("비밀번호가 올바르지 않아요.");
      return;
    }
    setPwErr("");
    setUnlocked(true);
  };

  const submit = () => {
    setErr("");
    start(async () => {
      const fd = new FormData();
      fd.set("userId", userId);
      fd.set("mode", mode);
      fd.set("password", pw);
      if (mode === "set") {
        fd.set("amount", setValue);
      } else {
        fd.set("direction", dir);
        fd.set("amount", amount);
      }
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

  // 잠금 화면 — 1234 입력 전엔 수정 UI를 감춘다(서버에서도 비밀번호를 한 번 더 검증).
  if (!unlocked) {
    return (
      <div className="card radj" style={{ marginBottom: 16 }}>
        <div className="row__sub" style={{ fontWeight: 800, color: "var(--fg)" }}>
          🔒 미수 수정은 잠겨 있어요
        </div>
        <div className="row__sub" style={{ marginTop: 2, marginBottom: 8 }}>
          비밀번호를 입력하면 미수금액을 조정할 수 있어요.
        </div>
        <input
          className="input"
          type="password"
          inputMode="numeric"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") unlock();
          }}
          placeholder="비밀번호"
          autoFocus
        />
        {pwErr && (
          <div className="notice notice--error" style={{ marginTop: 8 }}>
            {pwErr}
          </div>
        )}
        <div className="confirm__actions" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn--xs btn--ghost" onClick={close}>
            취소
          </button>
          <button type="button" className="btn btn--xs btn--primary" onClick={unlock}>
            잠금 해제
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card radj" style={{ marginBottom: 16 }}>
      {/* 모드 선택 — 직접 입력 / 가감(+/−) */}
      <div className="radj__dir">
        <button
          type="button"
          className={`radj__diropt ${mode === "set" ? "is-on" : ""}`}
          onClick={() => setMode("set")}
        >
          직접 입력
        </button>
        <button
          type="button"
          className={`radj__diropt ${mode === "delta" ? "is-on" : ""}`}
          onClick={() => setMode("delta")}
        >
          가감 (+/−)
        </button>
      </div>

      {mode === "set" ? (
        <>
          <div className="row__sub" style={{ margin: "2px 2px 6px" }}>
            현재 미수 {won(currentBalance)}원 · 바꿀 금액을 입력하세요
          </div>
          <MoneyInput
            value={setValue}
            onChange={setSetValue}
            placeholder="미수금액"
          />
        </>
      ) : (
        <>
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
        </>
      )}

      <input
        className="input"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder={
          mode === "set"
            ? "사유 (선택) — 예: 미수 재조정"
            : "사유 (예: 입금 누락 정정, 반품 차감)"
        }
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
