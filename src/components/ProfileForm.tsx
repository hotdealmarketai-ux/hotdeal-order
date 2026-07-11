"use client";

import { useActionState } from "react";
import { updateProfileAction, type ProfileState } from "@/app/actions/profile";
import { SubmitButton } from "./SubmitButton";

export function ProfileForm({
  storeName,
  phone,
  address,
}: {
  storeName: string;
  phone: string;
  address: string;
}) {
  const [state, formAction] = useActionState<ProfileState, FormData>(
    updateProfileAction,
    {},
  );

  return (
    <form action={formAction} className="stack">
      {state?.error && <div className="notice notice--error">{state.error}</div>}
      <div className="field">
        <label className="label" htmlFor="storeName">
          상호명
        </label>
        <input id="storeName" name="storeName" className="input" defaultValue={storeName} required />
      </div>
      <div className="field">
        <label className="label" htmlFor="phone">
          연락처
        </label>
        <input id="phone" name="phone" type="tel" className="input" defaultValue={phone} required />
      </div>
      <div className="field">
        <label className="label" htmlFor="address">
          주소
        </label>
        <input id="address" name="address" className="input" defaultValue={address} required />
      </div>
      <div className="field">
        <label className="label" htmlFor="password">
          새 비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="new-password"
        />
      </div>
      <SubmitButton pendingText="저장 중…">저장하기</SubmitButton>
    </form>
  );
}
