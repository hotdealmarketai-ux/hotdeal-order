"use client";

// 관리자 주간발주 편집기 — 지점의 그 주 발주에 품목 추가/제거/수량조절.
// 전체 카탈로그를 보여주고, 현재 발주 수량을 미리 채워 둔다.
//   · 수량을 넣으면 추가/유지 · 비우면(0) 제거 · 숫자 바꾸면 조절.
// 저장하면 그 목록 그대로 조용히 반영된다(점주 알림·수정표시 없음).
import { useMemo, useState } from "react";
import { adminEditWeeklyOrderAction } from "@/app/actions/weekly-invoice";
import { SubmitButton } from "./SubmitButton";
import {
  WEEKLY_CATEGORIES,
  boxWord,
  pieceWord,
  type WeeklyCategory,
} from "@/lib/weekly-catalog";
import type { WeeklyProductRow } from "@/lib/weekly";

const won = (n: number) => n.toLocaleString("ko-KR");
const catLabel = (k: string) =>
  WEEKLY_CATEGORIES.find((c) => c.key === k)?.label ?? k;

export function AdminWeeklyEditor({
  userId,
  weekKey,
  products,
  initialQty = {},
}: {
  userId: string;
  weekKey: string;
  products: WeeklyProductRow[];
  initialQty?: Record<string, string>;
}) {
  const [qtyByCode, setQtyByCode] = useState<Record<string, string>>(initialQty);
  const cats = WEEKLY_CATEGORIES.filter((c) =>
    products.some((p) => p.category === c.key),
  );
  const [active, setActive] = useState<WeeklyCategory>(
    (cats[0]?.key as WeeklyCategory) ?? "SNACK",
  );

  const setQty = (code: string, value: string) =>
    setQtyByCode((prev) => ({ ...prev, [code]: value }));

  const chosen = useMemo(
    () =>
      products
        .map((p) => {
          const qty = Math.floor(
            Number((qtyByCode[p.code] ?? "").replace(/[^0-9.]/g, "")),
          );
          return { p, qty: Number.isFinite(qty) && qty > 0 ? qty : 0 };
        })
        .filter((r) => r.qty > 0),
    [qtyByCode, products],
  );

  const payload = useMemo(
    () => chosen.map((r) => ({ code: r.p.code, qty: r.qty })),
    [chosen],
  );
  const totalItems = chosen.length;
  const totalAmount = chosen.reduce((n, r) => n + r.qty * r.p.supplyPrice, 0);
  const countByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of chosen) m[r.p.category] = (m[r.p.category] ?? 0) + 1;
    return m;
  }, [chosen]);

  const rows = products.filter((p) => p.category === active);

  return (
    <form action={adminEditWeeklyOrderAction}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="weekKey" value={weekKey} />
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <div className="cattabs cattabs--seg">
        {cats.map((c) => {
          const n = countByCat[c.key] ?? 0;
          return (
            <button
              type="button"
              key={c.key}
              className={`cattab ${active === c.key ? "is-active" : ""}`}
              onClick={() => setActive(c.key as WeeklyCategory)}
            >
              {c.label}
              {n > 0 && <span className="cattab__count">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="itemshead">
        <span className="itemshead__label">{catLabel(active)}</span>
        <span className="itemshead__count">{countByCat[active] ?? 0}개</span>
      </div>

      <div className="tofulist">
        {rows.map((p) => {
          const q = qtyByCode[p.code] ?? "";
          return (
            <div className={`tofuitem ${q.trim() ? "is-on" : ""}`} key={p.code}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="tofuitem__name">{p.name}</div>
                <div className="tofuitem__sub">
                  1{boxWord(p.category)} {p.perBox}
                  {pieceWord(p.category)} · {won(p.supplyPrice)}원
                </div>
              </div>
              <input
                className="input tofuitem__qty"
                inputMode="numeric"
                value={q}
                onChange={(e) => setQty(p.code, e.target.value)}
                placeholder={boxWord(p.category)}
              />
            </div>
          );
        })}
      </div>

      <div className="ctabar">
        <SubmitButton className="btn btn--primary btn--block" pendingText="저장 중…">
          저장
          {totalItems > 0 ? ` · ${totalItems}개 · ${won(totalAmount)}원` : ""}
        </SubmitButton>
      </div>
    </form>
  );
}
