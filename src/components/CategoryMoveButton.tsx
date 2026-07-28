"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setItemCategoryAction } from "@/app/actions/admin";
import { Sheet } from "./Sheet";

// 품목 1개의 카테고리 이동(수동 수정). 칩을 누르면 대분류/중분류를 골라 옮긴다.
// 기존 카테고리는 칩으로 제안하고, 없으면 직접 입력. 저장 즉시 반영.
export function CategoryMoveButton({
  itemId,
  name,
  major,
  minor,
  allMajors,
  minorsByMajor,
}: {
  itemId: string;
  name: string;
  major: string;
  minor: string;
  allMajors: string[];
  minorsByMajor: Record<string, string[]>;
}) {
  const router = useRouter();
  const [cur, setCur] = useState({ major, minor });
  const [open, setOpen] = useState(false);
  const [dMajor, setDMajor] = useState(major);
  const [dMinor, setDMinor] = useState(minor);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const openSheet = () => {
    setDMajor(cur.major);
    setDMinor(cur.minor);
    setErr("");
    setOpen(true);
  };

  const save = () => {
    const m = dMajor.trim();
    if (!m) {
      setErr("대분류를 골라주세요.");
      return;
    }
    start(async () => {
      const res = await setItemCategoryAction(itemId, m, dMinor.trim());
      if (!res.ok) {
        setErr(res.error ?? "이동에 실패했어요.");
        return;
      }
      setCur({ major: m, minor: dMinor.trim() });
      setOpen(false);
      router.refresh();
    });
  };

  // 현재 선택된 대분류의 중분류 후보(+ 다른 대분류들의 중분류도 참고로 노출은 안 함)
  const minorOpts = (minorsByMajor[dMajor.trim()] ?? []).filter(Boolean);

  return (
    <>
      <button type="button" className="catmove" onClick={openSheet}>
        {cur.major ? (
          <>
            {cur.major}
            {cur.minor ? ` · ${cur.minor}` : ""}
          </>
        ) : (
          <span className="catmove--none">분류 없음</span>
        )}
        <span className="catmove__edit" aria-hidden="true">
          바꾸기
        </span>
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="sheet__panel catsheet" style={{ maxWidth: 480 }}>
            <div className="stocksheet__grip" aria-hidden="true" />
            <div className="catsheet__title">{name} — 분류 이동</div>

            <div className="catsheet__label">대분류</div>
            <div className="catsheet__chips">
              {allMajors.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`catchip ${dMajor.trim() === m ? "is-on" : ""}`}
                  onClick={() => setDMajor(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <input
              className="input input--compact"
              placeholder="새 대분류 직접 입력"
              value={allMajors.includes(dMajor.trim()) ? "" : dMajor}
              onChange={(e) => setDMajor(e.target.value)}
              style={{ marginTop: 6 }}
            />

            <div className="catsheet__label" style={{ marginTop: 14 }}>
              중분류 <span className="catsheet__opt">(없으면 대분류만)</span>
            </div>
            <div className="catsheet__chips">
              <button
                type="button"
                className={`catchip ${dMinor.trim() === "" ? "is-on" : ""}`}
                onClick={() => setDMinor("")}
              >
                없음
              </button>
              {minorOpts.map((mn) => (
                <button
                  key={mn}
                  type="button"
                  className={`catchip ${dMinor.trim() === mn ? "is-on" : ""}`}
                  onClick={() => setDMinor(mn)}
                >
                  {mn}
                </button>
              ))}
            </div>
            <input
              className="input input--compact"
              placeholder="새 중분류 직접 입력(선택)"
              value={minorOpts.includes(dMinor.trim()) ? "" : dMinor}
              onChange={(e) => setDMinor(e.target.value)}
              style={{ marginTop: 6 }}
            />

            {err && <div className="chaterr" style={{ marginTop: 10 }}>{err}</div>}

            <div className="confirm__actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={save}
                disabled={pending}
              >
                {pending ? "이동 중…" : "이동"}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
