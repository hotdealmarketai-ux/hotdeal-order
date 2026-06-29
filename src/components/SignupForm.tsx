"use client";

import { useActionState } from "react";
import { signupAction, type FormState } from "@/app/actions/auth";
import { SubmitButton } from "./SubmitButton";

export function SignupForm() {
  const [state, formAction] = useActionState<FormState, FormData>(signupAction, {});
  return (
    <form action={formAction} className="stack">
      {state?.error && <div className="notice notice--error">{state.error}</div>}

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
          업장 소재지<span className="req">*</span>
        </label>
        <input id="address" name="address" className="input" required />
      </div>

      <div className="field">
        <label className="label" htmlFor="businessCert">
          사업자등록증
        </label>
        <input
          id="businessCert"
          name="businessCert"
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="file-input"
        />
        <p className="hint">사진을 찍거나 파일을 올려주세요. (선택)</p>
      </div>

      <div className="divider" />

      <div className="field">
        <label className="label" htmlFor="username">
          아이디 (영문·숫자 3자 이상)<span className="req">*</span>
        </label>
        <input
          id="username"
          name="username"
          className="input"
          autoComplete="username"
          required
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="password">
          비밀번호 (4자 이상)<span className="req">*</span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="new-password"
          required
        />
      </div>

      <SubmitButton pendingText="신청 중…">가입 신청하기</SubmitButton>
      <p className="hint center">
        가입 신청 후 본사 승인이 되면 발주를 넣을 수 있어요.
      </p>
    </form>
  );
}
