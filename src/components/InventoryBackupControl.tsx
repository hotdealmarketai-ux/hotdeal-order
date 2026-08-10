"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  backupInventoryAction,
  listInventoryBackupsAction,
  restoreInventoryBackupAction,
} from "@/app/actions/admin";
import { Sheet } from "./Sheet";
import { ConfirmSheet } from "./ConfirmSheet";

type Snap = { key: string; label: string; count: number; createdAt: string };

const fmt = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// #2 재고 백업/복구 — [백업]으로 현재 재고를 저장, [복구]로 지난 시점으로 되돌림.
export function InventoryBackupControl() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [snaps, setSnaps] = useState<Snap[] | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const backup = () =>
    start(async () => {
      setMsg("");
      const r = await backupInventoryAction();
      setMsg(r.ok ? `백업됨 · ${r.count}품목` : r.error ?? "백업 실패");
    });

  const openList = () => {
    setOpen(true);
    setSnaps(null);
    start(async () => setSnaps(await listInventoryBackupsAction()));
  };

  const restore = (key: string) =>
    start(async () => {
      const r = await restoreInventoryBackupAction(key);
      setConfirmKey(null);
      setOpen(false);
      setMsg(r.ok ? `복구됨 · ${r.restored}품목` : r.error ?? "복구 실패");
      router.refresh();
    });

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ display: "flex", gap: 14 }}>
        <button
          type="button"
          className="btn btn--soft btn--sm"
          style={{ flex: 1 }}
          disabled={pending}
          onClick={backup}
        >
          재고 백업
        </button>
        <button
          type="button"
          className="btn btn--soft btn--sm"
          style={{ flex: 1 }}
          disabled={pending}
          onClick={openList}
        >
          복구
        </button>
      </div>
      {msg && (
        <div className="row__sub" style={{ color: "var(--green-700)", fontWeight: 700 }}>
          {msg}
        </div>
      )}

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="sheet__panel" style={{ maxWidth: 460 }}>
            <div className="sheet__head">
              <div className="sheet__title">재고 복구</div>
              <button
                type="button"
                className="sheet__close"
                aria-label="닫기"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>
            {snaps === null ? (
              <div className="row__sub">불러오는 중…</div>
            ) : snaps.length === 0 ? (
              <div className="empty">
                <p>저장된 백업이 없어요.</p>
              </div>
            ) : (
              <div className="list">
                {snaps.map((s) => (
                  <div className="row" key={s.key}>
                    <div className="row__main">
                      <div className="row__title">{fmt(s.createdAt)}</div>
                      <div className="row__sub">
                        {s.label} · {s.count}품목
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--xs btn--soft"
                      disabled={pending}
                      onClick={() => setConfirmKey(s.key)}
                    >
                      복구
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Sheet>
      )}

      {confirmKey && (
        <ConfirmSheet
          title="이 시점으로 되돌릴까요?"
          confirmLabel="복구"
          onConfirm={() => restore(confirmKey)}
          onClose={() => setConfirmKey(null)}
        />
      )}
    </div>
  );
}
