"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  previewInventoryFromSheetAction,
  importInventoryFromSheetAction,
  type SheetImportPreview,
} from "@/app/actions/admin";

const won = (n: number) => n.toLocaleString("ko-KR");

// 1회성 '구글시트 → 앱' 재고 불러오기. 미리보기(시트 내용 확인) → 확인 → 삭제 없이 upsert.
export function SheetImportButton() {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "preview" | "done">("idle");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Extract<SheetImportPreview, { ok: true }> | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function doPreview() {
    setBusy(true);
    setError("");
    const p = await previewInventoryFromSheetAction();
    setBusy(false);
    if (!p.ok) {
      setError(p.error);
      return;
    }
    setPreview(p);
    setMode("preview");
  }

  async function doImport() {
    setBusy(true);
    setError("");
    const r = await importInventoryFromSheetAction();
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "불러오기에 실패했어요.");
      return;
    }
    setResult(`시트에서 불러왔어요 — 신규 ${r.added} · 갱신 ${r.updated}건.`);
    setMode("done");
    router.refresh();
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="section-label" style={{ margin: "0 0 8px" }}>
        시트에서 불러오기 (1회)
      </div>

      {mode === "done" ? (
        <div className="notice notice--ok">✓ {result}</div>
      ) : mode === "preview" && preview ? (
        <div className="confirm">
          <div className="confirm__title">
            시트에서 {preview.sheetItems}개 품목을 찾았어요.
          </div>
          <p className="confirm__hint">
            신규 {preview.willAdd} · 갱신 {preview.willUpdate}건. 앱에만 있는 품목은
            삭제하지 않아요. 이대로 불러올까요?
          </p>
          <div className="bulkprev" style={{ maxHeight: 240, overflowY: "auto" }}>
            {preview.sample.map((r, i) => (
              <div className="bulkprev__row" key={i}>
                <span className="bulkprev__name">
                  {r.name}
                  {r.expiry && <span className="bulkprev__exp">유통 {r.expiry}</span>}
                </span>
                <span className="bulkprev__qty">{r.qty}</span>
                <span className="bulkprev__price">{won(r.supplyPrice)}원</span>
              </div>
            ))}
            {preview.sheetItems > preview.sample.length && (
              <div className="hint" style={{ padding: "6px 2px" }}>
                …외 {preview.sheetItems - preview.sample.length}개
              </div>
            )}
          </div>
          <div className="confirm__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setMode("idle")}
              disabled={busy}
            >
              취소
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={doImport}
              disabled={busy}
            >
              {busy ? "불러오는 중…" : "네, 불러오기"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 8 }}>
            구글시트에 입력해 둔 재고를 앱으로 한 번 가져옵니다. (이후 수정은 앱에서 —
            시트는 앱을 비추는 거울이에요.)
          </p>
          <button
            type="button"
            className="btn btn--soft btn--sm"
            onClick={doPreview}
            disabled={busy}
          >
            {busy ? "시트 읽는 중…" : "시트에서 불러오기"}
          </button>
        </>
      )}

      {error && (
        <div className="notice notice--error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  );
}
