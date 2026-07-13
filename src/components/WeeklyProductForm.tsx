"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import {
  saveWeeklyProductsAction,
  type WeeklyProductState,
} from "@/app/actions/weekly-invoice";
import { SubmitButton } from "./SubmitButton";
import {
  WEEKLY_CATEGORIES,
  boxWord,
  pieceWord,
  type WeeklyCategory,
} from "@/lib/weekly-catalog";
import type { WeeklyProductRow } from "@/lib/weekly";

type Row = {
  key: string;
  code: string | null;
  category: WeeklyCategory;
  name: string;
  perBox: string;
  supplyPrice: string;
  deleted: boolean;
};

export function WeeklyProductForm({ initial }: { initial: WeeklyProductRow[] }) {
  const uid = useRef(0);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((p) => ({
      key: `k${uid.current++}`,
      code: p.code,
      category: p.category as WeeklyCategory,
      name: p.name,
      perBox: String(p.perBox),
      supplyPrice: String(p.supplyPrice),
      deleted: false,
    })),
  );
  const [active, setActive] = useState<WeeklyCategory>(WEEKLY_CATEGORIES[0].key);
  const [state, formAction] = useActionState<WeeklyProductState, FormData>(
    saveWeeklyProductsAction,
    {},
  );

  function update(key: string, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }
  // 신규행은 목록에서 제거, 기존행은 deleted 마크(저장 시 소프트삭제)
  function remove(key: string) {
    setRows((prev) =>
      prev
        .map((r) => (r.key === key ? { ...r, deleted: true } : r))
        .filter((r) => !(r.deleted && !r.code)),
    );
  }
  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        key: `k${uid.current++}`,
        code: null,
        category: active,
        name: "",
        perBox: "1",
        supplyPrice: "0",
        deleted: false,
      },
    ]);
  }

  // 탭을 옮겨도 rows에 모든 편집이 유지됨(제출 시 전부 전송)
  const payload = useMemo(
    () =>
      rows.map((r) => ({
        code: r.code,
        category: r.category,
        name: r.name,
        perBox: r.perBox,
        supplyPrice: r.supplyPrice,
        deleted: r.deleted,
      })),
    [rows],
  );
  const countByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) if (!r.deleted) m[r.category] = (m[r.category] ?? 0) + 1;
    return m;
  }, [rows]);
  const shown = rows.filter((r) => r.category === active && !r.deleted);

  return (
    <form action={formAction}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      {state?.ok && (
        <div className="notice notice--ok" style={{ marginBottom: 12 }}>
          저장했어요.
        </div>
      )}

      <div className="cattabs cattabs--seg">
        {WEEKLY_CATEGORIES.map((c) => (
          <button
            type="button"
            key={c.key}
            className={`cattab ${active === c.key ? "is-active" : ""}`}
            onClick={() => setActive(c.key)}
          >
            {c.label}
            {(countByCat[c.key] ?? 0) > 0 && (
              <span className="cattab__count">{countByCat[c.key]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="itemshead">
        <span className="itemshead__label">상품 관리</span>
        <span className="itemshead__count">{shown.length}개</span>
      </div>

      {shown.map((r) => (
        <div className="wprow" key={r.key}>
          <input
            className="input wprow__name"
            value={r.name}
            onChange={(e) => update(r.key, "name", e.target.value)}
            placeholder="품목명"
          />
          <div className="wprow__nums">
            <span className="wprow__field">
              1{boxWord(r.category)}{" "}
              <input
                className="input"
                inputMode="numeric"
                value={r.perBox}
                onChange={(e) => update(r.key, "perBox", e.target.value)}
              />{" "}
              {pieceWord(r.category)}
            </span>
            <span className="wprow__field">
              공급가{" "}
              <input
                className="input"
                inputMode="numeric"
                value={r.supplyPrice}
                onChange={(e) => update(r.key, "supplyPrice", e.target.value)}
              />{" "}
              원
            </span>
            <button
              type="button"
              className="linkbtn linkbtn--danger"
              onClick={() => remove(r.key)}
            >
              삭제
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn btn--soft btn--block"
        onClick={addRow}
        style={{ marginTop: 10 }}
      >
        + 상품 추가
      </button>

      <div className="ctabar">
        <SubmitButton className="btn btn--primary btn--block" pendingText="저장 중…">
          저장
        </SubmitButton>
      </div>
    </form>
  );
}
