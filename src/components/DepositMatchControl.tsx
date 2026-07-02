"use client";

import { useState } from "react";
import {
  matchDepositManuallyAction,
  ignoreDepositAction,
} from "@/app/actions/deposit";
import { SubmitButton } from "./SubmitButton";

type StoreOpt = { id: string; label: string };

// 미매칭 입금 1건을 관리자가 점포로 수동 매칭하거나 '무시' 처리
export function DepositMatchControl({
  depositId,
  payerName,
  stores,
}: {
  depositId: string;
  payerName: string;
  stores: StoreOpt[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn--xs btn--soft"
        onClick={() => setOpen(true)}
      >
        매칭
      </button>
    );
  }

  return (
    <div className="depmatch">
      <form action={matchDepositManuallyAction} className="depmatch__form">
        <input type="hidden" name="depositId" value={depositId} />
        <select name="userId" className="input" defaultValue="" required>
          <option value="" disabled>
            점포 선택
          </option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {payerName && (
          <label className="depmatch__remember">
            <input type="checkbox" name="remember" value="true" defaultChecked />
            <span>입금자명 &lsquo;{payerName}&rsquo; 이 점포로 기억</span>
          </label>
        )}
        <div className="depmatch__actions">
          <button
            type="button"
            className="btn btn--xs btn--ghost"
            onClick={() => setOpen(false)}
          >
            취소
          </button>
          <SubmitButton className="btn btn--xs btn--primary" pendingText="처리 중…">
            이 점포로 매칭
          </SubmitButton>
        </div>
      </form>
      <form action={ignoreDepositAction} className="depmatch__ignore">
        <input type="hidden" name="depositId" value={depositId} />
        <button type="submit" className="linkbtn">
          점포 입금 아님 (무시)
        </button>
      </form>
    </div>
  );
}
