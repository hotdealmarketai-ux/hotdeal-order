"use client";

import { useState, useTransition } from "react";
import { saveAllInventoryAction } from "@/app/actions/admin";

type Item = { id: string; name: string; qty: string; supplyPrice: string };

// Q5 재고 '등록된 재고' — 품목별 저장 대신 전체를 한 번에 저장. 헤더 밑 가운데 저장 버튼 1개.
// 각 행의 '삭제'는 목록에서 빼두고, 저장 시 실제 삭제 반영(빠진 항목은 DB에서 제거).
export function InventoryEditor({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState<Item[]>(initial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const setField = (id: string, k: keyof Item, v: string) => {
    setSaved(false);
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [k]: v } : it)));
  };
  const remove = (id: string) => {
    setSaved(false);
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const save = () => {
    setSaved(false);
    start(async () => {
      await saveAllInventoryAction(JSON.stringify(items));
      setSaved(true);
    });
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", margin: "2px 0 14px" }}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={save}
          disabled={pending}
          style={{ minWidth: 180 }}
        >
          {pending ? "저장 중…" : saved ? "저장됨 ✓" : "저장"}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <p>등록된 재고가 없어요.</p>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {items.map((it) => (
            <div className="card" key={it.id} style={{ padding: 12 }}>
              <div
                style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
              >
                <input
                  className="input input--compact"
                  value={it.name}
                  placeholder="품목명"
                  onChange={(e) => setField(it.id, "name", e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="linkbtn linkbtn--danger"
                  onClick={() => remove(it.id)}
                  style={{ flexShrink: 0 }}
                >
                  삭제
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                  남은 수량
                </span>
                <input
                  className="input input--compact"
                  inputMode="numeric"
                  value={it.qty}
                  placeholder="수량"
                  onChange={(e) => setField(it.id, "qty", e.target.value)}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                  공급가
                </span>
                <input
                  className="input input--compact"
                  inputMode="numeric"
                  value={it.supplyPrice}
                  placeholder="원"
                  onChange={(e) => setField(it.id, "supplyPrice", e.target.value)}
                  style={{ flex: 1, minWidth: 0 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
