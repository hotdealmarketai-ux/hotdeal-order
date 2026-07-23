"use client";

import { useState, useRef, useEffect } from "react";
import { autosaveInventoryAction } from "@/app/actions/admin";
import { InvSearch } from "./InvSearch";

type Item = { id: string; name: string; qty: string; supplyPrice: string };

// R4 재고 자동저장 — 입력하는 족족(디바운스 0.8s) DB에 저장. 시트는 크론이 주기적으로 반영(단방향).
// 각 품목은 한 줄(품목명 · 수량 · 공급가 · 삭제)로 컴팩트하게.
export function InventoryEditor({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState<Item[]>(initial);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(items);
  latest.current = items;
  // 각 행이 '마지막으로 저장/로드된' 수량 — 서버가 관리자가 실제 바꾼 행만 반영하게 함(과다판매 방지).
  const baseline = useRef<Record<string, string>>(
    Object.fromEntries(initial.map((it) => [it.id, it.qty])),
  );

  const scheduleSave = () => {
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const snapshot = latest.current;
      const payload = snapshot.map((it) => ({
        ...it,
        baseQty: baseline.current[it.id] ?? it.qty,
      }));
      try {
        await autosaveInventoryAction(JSON.stringify(payload));
        // 저장 성공 → 기준값을 방금 보낸 수량으로 갱신(다음 변경 판별 기준)
        const nb: Record<string, string> = {};
        for (const it of snapshot) nb[it.id] = it.qty;
        baseline.current = nb;
        setStatus("saved");
      } catch {
        setStatus("idle");
      }
    }, 800);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setField = (id: string, k: keyof Item, v: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [k]: v } : it)));
    scheduleSave();
  };
  const remove = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    scheduleSave();
  };

  // 검색은 '표시'만 필터 — items(전체)는 그대로 유지해야 자동저장이 필터된 행을 지우지 않는다.
  const query = q.trim().toLowerCase();
  const visible = query
    ? items.filter((it) => it.name.toLowerCase().includes(query))
    : items;

  return (
    <>
      <InvSearch value={q} onChange={setQ} />

      <div className="invedit__status">
        {status === "saving" ? "저장 중…" : status === "saved" ? "자동 저장됨 ✓" : " "}
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <p>등록된 재고가 없어요.</p>
        </div>
      ) : query && visible.length === 0 ? (
        <div className="empty">
          <p>‘{q.trim()}’ 검색 결과가 없어요.</p>
        </div>
      ) : (
        <div className="invtable">
          <div className="invrow invrow--head">
            <span className="invcol invcol--name">품목명</span>
            <span className="invcol invcol--qty">남은 수량</span>
            <span className="invcol invcol--price">공급가</span>
            <span className="invcol invcol--del" />
          </div>
          {visible.map((it) => (
            <div className="invrow" key={it.id}>
              <input
                className="invin invcol--name"
                value={it.name}
                placeholder="품목명"
                onChange={(e) => setField(it.id, "name", e.target.value)}
              />
              <input
                className="invin invcol--qty"
                inputMode="numeric"
                value={it.qty}
                placeholder="0"
                onChange={(e) => setField(it.id, "qty", e.target.value)}
              />
              <input
                className="invin invcol--price"
                inputMode="numeric"
                value={it.supplyPrice}
                placeholder="0"
                onChange={(e) => setField(it.id, "supplyPrice", e.target.value)}
              />
              <button
                type="button"
                className="invrow__del invcol--del"
                onClick={() => remove(it.id)}
                aria-label="삭제"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
