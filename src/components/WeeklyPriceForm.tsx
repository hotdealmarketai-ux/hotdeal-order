"use client";

import { useActionState, useMemo, useState } from "react";
import {
  saveWeeklyPricesAction,
  type WeeklyPriceState,
} from "@/app/actions/weekly-invoice";
import { SubmitButton } from "./SubmitButton";
import { WEEKLY_CATALOG, WEEKLY_CATEGORIES } from "@/lib/weekly-catalog";

const won = (n: number) => n.toLocaleString("ko-KR");

export function WeeklyPriceForm({
  effective,
}: {
  effective: Record<string, number>;
}) {
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const it of WEEKLY_CATALOG)
      m[it.seq] = String(effective[it.seq] ?? it.boxPrice);
    return m;
  });
  const [state, formAction] = useActionState<WeeklyPriceState, FormData>(
    saveWeeklyPricesAction,
    {},
  );

  const payload = useMemo(
    () =>
      WEEKLY_CATALOG.map((it) => ({
        code: it.seq,
        boxPrice: prices[it.seq] ?? "",
      })),
    [prices],
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      {state?.ok && (
        <div className="notice notice--ok" style={{ marginBottom: 12 }}>
          단가를 저장했어요.
        </div>
      )}

      {WEEKLY_CATEGORIES.map((c) => {
        const items = WEEKLY_CATALOG.filter((it) => it.category === c.key);
        return (
          <div className="invcat" key={c.key}>
            <div className="invcat__head">
              <span className="chip">{c.label}</span>
              <span className="invcat__sum">{items.length}품목</span>
            </div>
            {items.map((it) => {
              const changed =
                Math.floor(Number((prices[it.seq] ?? "").replace(/[^0-9]/g, ""))) !==
                it.boxPrice;
              return (
                <div className="tofuitem" key={it.seq} style={{ marginBottom: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tofuitem__name">{it.name}</div>
                    <div className="tofuitem__sub">
                      {it.boxUnit && <span>{it.boxUnit} · </span>}
                      기본 {won(it.boxPrice)}원{changed ? " (변경됨)" : ""}
                    </div>
                  </div>
                  <input
                    className="input tofuitem__qty"
                    inputMode="numeric"
                    value={prices[it.seq] ?? ""}
                    onChange={(e) =>
                      setPrices((prev) => ({ ...prev, [it.seq]: e.target.value }))
                    }
                    placeholder="단가"
                    style={{ width: 96 }}
                  />
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="ctabar">
        <SubmitButton className="btn btn--primary btn--block" pendingText="저장 중…">
          단가 저장
        </SubmitButton>
      </div>
    </form>
  );
}
