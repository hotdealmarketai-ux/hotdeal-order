"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  merchantToggleCheckAction,
  adminToggleCheckAction,
} from "@/app/actions/onboarding";

// 체크박스 토글. userId 있으면 관리자가 그 점포 대신 체크, 없으면 점주 본인.
export function OnbCheckbox({
  blockId,
  label,
  checked,
  userId,
}: {
  blockId: string;
  label: string;
  checked: boolean;
  userId?: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(checked);
  const [pending, start] = useTransition();

  const toggle = () =>
    start(async () => {
      const next = !on;
      setOn(next); // 낙관적
      const res = userId
        ? await adminToggleCheckAction({ userId, blockId, checked: next })
        : await merchantToggleCheckAction({ blockId, checked: next });
      if (res.error) {
        setOn(!next);
        alert(res.error);
        return;
      }
      router.refresh(); // 진행률 갱신
    });

  return (
    <button
      type="button"
      className={`onbcheck ${on ? "is-on" : ""}`}
      onClick={toggle}
      disabled={pending}
    >
      <span className="onbcheck__box" aria-hidden>
        {on ? "✓" : ""}
      </span>
      {label && <span className="onbcheck__label">{label}</span>}
    </button>
  );
}
