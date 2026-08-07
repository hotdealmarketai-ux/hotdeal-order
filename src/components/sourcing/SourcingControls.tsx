"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setLeadStatusAction,
  setProductStatusAction,
  deleteLeadAction,
  deleteProductAction,
  addManualLeadAction,
  addManualProductAction,
  runSourcingNowAction,
} from "@/app/actions/sourcing";

export function RunButton({ track }: { track: "local" | "mealkit" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const go = () =>
    start(async () => {
      setMsg("");
      const res = await runSourcingNowAction({ track });
      setMsg(res.error || res.msg || "완료");
      router.refresh();
    });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button className="btn btn--sm btn--primary" onClick={go} disabled={pending}>
        {pending ? "수집 중…" : "지금 수집"}
      </button>
      {msg && <span className="hint">{msg}</span>}
    </div>
  );
}

// 로컬 후보 상태 버튼
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
      <button className={`btn btn--xs ${status === "PICKED" ? "btn--primary" : "btn--soft"}`} onClick={() => set("PICKED")} disabled={pending}>
        담기
      </button>
      <button className={`btn btn--xs ${status === "IGNORED" ? "btn--primary" : "btn--soft"}`} onClick={() => set("IGNORED")} disabled={pending}>
        무시
      </button>
      <button className="btn btn--xs btn--ghost" onClick={remove} disabled={pending} aria-label="삭제">
        ✕
      </button>
    </div>
  );
}

export function ManualLeadForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", region: "", category: "", phone: "", url: "", note: "" });
  const add = () =>
    start(async () => {
      const res = await addManualLeadAction(f);
      if (res.error) { alert(res.error); return; }
      setF({ name: "", region: "", category: "", phone: "", url: "", note: "" });
      setOpen(false);
      router.refresh();
    });
  if (!open) return <button className="btn btn--sm btn--soft" onClick={() => setOpen(true)}>+ 직접 추가</button>;
  return (
    <div className="card" style={{ display: "grid", gap: 8, marginBottom: 12 }}>
      <input className="input" placeholder="상호" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="지역" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} />
        <input className="input" placeholder="분류(베이커리/디저트/떡)" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="전화" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input className="input" placeholder="링크/인스타" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      </div>
      <input className="input" placeholder="메모" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn--sm btn--primary" onClick={add} disabled={pending || !f.name.trim()}>추가</button>
        <button className="btn btn--sm btn--ghost" onClick={() => setOpen(false)}>취소</button>
      </div>
    </div>
  );
}

export function ManualProductForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", brand: "", price: "", url: "", note: "" });
  const add = () =>
    start(async () => {
      const res = await addManualProductAction(f);
      if (res.error) { alert(res.error); return; }
      setF({ name: "", brand: "", price: "", url: "", note: "" });
      setOpen(false);
      router.refresh();
    });
  if (!open) return <button className="btn btn--sm btn--soft" onClick={() => setOpen(true)}>+ 직접 추가</button>;
  return (
    <div className="card" style={{ display: "grid", gap: 8, marginBottom: 12 }}>
      <input className="input" placeholder="제품명" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="브랜드" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
        <input className="input" placeholder="가격" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
      </div>
      <input className="input" placeholder="링크" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      <input className="input" placeholder="메모" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn--sm btn--primary" onClick={add} disabled={pending || !f.name.trim()}>추가</button>
        <button className="btn btn--sm btn--ghost" onClick={() => setOpen(false)}>취소</button>
      </div>
    </div>
  );
}
