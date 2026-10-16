"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOrderModeFlagAction } from "@/app/actions/order-config";

// 발주 방식(칸 발주·채팅 발주 켜고 끄기) — 발주 시스템 관리 화면 카드.
// 품목 제한 모드가 전 지점에 '지금' 적용 중이면 칸 발주는 항상 켜짐·채팅 발주는 자동 잠금(effectiveChannels 와 같은 규칙).
// (옛 '품목 고정'이 켜져 있던 경우도 같은 잠금 — 그 설정 화면은 없앴지만 서버 규칙은 그대로 따른다)
export function OrderChannelCard({
  config,
  restrict,
}: {
  config: { gridOff: boolean; chatOff: boolean; fixedFruit: boolean; fixedVeg: boolean };
  restrict: { on: boolean; allStores: boolean; active: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const planLock = restrict.on && restrict.allStores && restrict.active;
  const locked = config.fixedFruit || config.fixedVeg || planLock;

  function toggle(key: "gridOff" | "chatOff", on: boolean) {
    setErr("");
    const fd = new FormData();
    fd.set("key", key);
    fd.set("on", on ? "true" : "false");
    start(async () => {
      const res = await setOrderModeFlagAction(fd).catch(() => ({ error: "처리 중 문제가 생겼어요." }));
      if (res?.error) setErr(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="card ocfg-card oplan-channel">
      <div className="ocfg-card__title">발주 방식</div>
      <div className="ocfg-row">
        <div className="ocfg-row__main">
          <div className="ocfg-row__lab">칸 발주</div>
        </div>
        <Switch
          on={planLock ? true : !config.gridOff}
          disabled={pending || locked}
          onToggle={() => toggle("gridOff", !config.gridOff)}
          label="칸 발주"
        />
      </div>
      <div className="ocfg-row">
        <div className="ocfg-row__main">
          <div className="ocfg-row__lab">채팅 발주</div>
        </div>
        {locked ? (
          <span className="ocfg-lock">자동 잠금</span>
        ) : (
          <Switch on={!config.chatOff} disabled={pending} onToggle={() => toggle("chatOff", !config.chatOff)} label="채팅 발주" />
        )}
      </div>
      {err && (
        <div className="notice notice--error" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
    </div>
  );
}

function Switch({ on, disabled, onToggle, label }: { on: boolean; disabled?: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch ${on ? "is-on" : ""}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <span className="switch__knob" />
    </button>
  );
}
