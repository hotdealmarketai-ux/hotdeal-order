"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setLeadStatusAction,
  setProductStatusAction,
  deleteLeadAction,
  deleteProductAction,
} from "@/app/actions/sourcing";

// 로컬·밀키트 공통 상태 버튼(둘 다 직접 컨택하므로 동일).
const LEAD_ACTIONS = [
  { s: "CONTACTED", label: "컨택함" },
  { s: "DEAL", label: "성사" },
  { s: "REJECTED", label: "거절" },
  { s: "IGNORED", label: "무시" },
];

export function LeadStatusButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (s: string) =>
    start(async () => {
      await setLeadStatusAction({ id, status: s === status ? "NEW" : s });
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      if (!confirm("이 후보를 삭제할까요?")) return;
      await deleteLeadAction({ id });
      router.refresh();
    });
  return (
    <div className="srcbtns">
      {LEAD_ACTIONS.map((a) => (
        <button
          key={a.s}
          className={`btn btn--xs ${status === a.s ? "btn--primary" : "btn--soft"}`}
          onClick={() => set(a.s)}
          disabled={pending}
        >
          {a.label}
        </button>
      ))}
      <button className="btn btn--xs btn--ghost" onClick={remove} disabled={pending} aria-label="삭제">
        ✕
      </button>
    </div>
  );
}

export function ProductStatusButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (s: string) =>
    start(async () => {
      await setProductStatusAction({ id, status: s === status ? "NEW" : s });
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      if (!confirm("이 후보를 삭제할까요?")) return;
      await deleteProductAction({ id });
      router.refresh();
    });
  return (
    <div className="srcbtns">
      {LEAD_ACTIONS.map((a) => (
        <button
          key={a.s}
          className={`btn btn--xs ${status === a.s ? "btn--primary" : "btn--soft"}`}
          onClick={() => set(a.s)}
          disabled={pending}
        >
          {a.label}
        </button>
      ))}
      <button className="btn btn--xs btn--ghost" onClick={remove} disabled={pending} aria-label="삭제">
        ✕
      </button>
    </div>
  );
}
