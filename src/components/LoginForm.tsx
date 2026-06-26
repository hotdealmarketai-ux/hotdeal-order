"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "@/app/actions/auth";
import { SubmitButton } from "./SubmitButton";

export function LoginForm() {
  const [state, formAction] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={formAction} className="stack">
      {state?.error && <div className="notice notice--error">{state.error}</div>}
      <div className="field">
        <label className="label" htmlFor="username">
          아이디
        </label>
        <input
          id="username"
          name="username"
          className="input"
          autoComplete="username"
          placeholder="아이디"
          required
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="password">
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          placeholder="비밀번호"
          required
        />
      </div>
      <SubmitButton pendingText="로그인 중…">로그인</SubmitButton>
    </form>
  );
}
