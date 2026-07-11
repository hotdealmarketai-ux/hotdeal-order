"use client";

import { useActionState, useState } from "react";
import { signupAction, type FormState } from "@/app/actions/auth";
import { SubmitButton } from "./SubmitButton";

export function SignupForm() {
  const [state, formAction] = useActionState<FormState, FormData>(signupAction, {});
  const [fileName, setFileName] = useState("");
  return (
    <form action={formAction} className="stack">
      {state?.error && <div className="notice notice--error">{state.error}</div>}

      <div className="field">
        <label className="label" htmlFor="username">
          아이디<span className="req">*</span>
        </label>
        <input
          id="username"
          name="username"
          className="input"
          placeholder="영문·숫자 3자 이상"
          autoComplete="username"
          required
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="password">
          비밀번호<span className="req">*</span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          placeholder="4자 이상"
          autoComplete="new-password"
          required
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="storeName">
          상호명<span className="req">*</span>
        </label>
        <input id="storeName" name="storeName" className="input" required />
      </div>

      <div className="field">
        <label className="label" htmlFor="phone">
          연락처<span className="req">*</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          className="input"
          autoComplete="tel"
          required
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="address">
          주소<span className="req">*</span>
        </label>
        <input id="address" name="address" className="input" required />
      </div>

      <div className="field">
        <label className="label" htmlFor="payerName">
          예금주 (입금자명)<span className="req">*</span>
        </label>
        <input
          id="payerName"
          name="payerName"
          className="input"
          placeholder="입금 시 통장에 찍히는 이름"
          required
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="businessCert">
          사업자등록증
        </label>
        <label className="file-drop">
          <input
            id="businessCert"
            name="businessCert"
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="sr-only"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
          />
          <span className="file-drop__title">{fileName || "파일 올리기"}</span>
          <span className="file-drop__sub">jpg · png · pdf, 10MB 이하</span>
        </label>
      </div>

      <SubmitButton pendingText="신청 중…">가입 신청하기</SubmitButton>
      <p className="hint center">
        가입 신청 후 본사 승인이 되면 발주를 넣을 수 있어요.
      </p>
    </form>
  );
}
