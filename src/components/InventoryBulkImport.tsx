"use client";

// 엑셀(스프레드시트)에서 복사한 재고를 앱에 한번에 붙여넣어 반영.
// 시트를 고치는 게 아니라 '앱(원본)'에 직접 넣는다. 붙여넣은 목록으로 전체 교체.
// 붙여넣기 → 미리보기(신규/갱신/삭제 건수 + 삭제 목록) → 재확인 → 반영.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { bulkReplaceInventoryAction } from "@/app/actions/admin";

type Row = { name: string; qty: number; supplyPrice: number };

function toInt(v: string): number {
  const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

type ParseResult = {
  rows: Row[]; // 이름 기준 dedupe된 최종 목록
  dupNames: string[]; // 두 번 이상 나온 품목명(첫 줄만 반영, 나머지 무시)
  dataLines: number; // 헤더/빈줄 제외한 붙여넣은 데이터 줄 수
  skippedHeader: boolean;
};
// 붙여넣은 텍스트 파싱 — 탭(엑셀 기본) 우선, 없으면 콤마. 이름 기준 dedupe. 헤더줄 스킵.
function parseRows(text: string): ParseResult {
  const seen = new Set<string>();
  const dup = new Set<string>();
  const rows: Row[] = [];
  let dataLines = 0;
  let skippedHeader = false;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = raw.includes("\t") ? raw.split("\t") : raw.split(",");
    const name = (cells[0] ?? "").trim();
    if (!name) continue;
    const c1 = (cells[1] ?? "").trim();
    const c2 = (cells[2] ?? "").trim();
    // 헤더줄 추정 시 스킵(품목/상품/이름 + 수량/재고/공급/단가/가격)
    if (/품목|상품|이름/.test(name) && /수량|재고|공급|단가|가격/.test(c1 + c2)) {
      skippedHeader = true;
      continue;
    }
    dataLines++;
    if (seen.has(name)) {
      dup.add(name); // 같은 이름 두 번째부터 — 첫 줄만 반영
      continue;
    }
    seen.add(name);
    rows.push({ name, qty: toInt(c1), supplyPrice: toInt(c2) });
  }
  return { rows, dupNames: [...dup], dataLines, skippedHeader };
}

export function InventoryBulkImport({ currentNames }: { currentNames: string[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");

  const { rows: parsed, dupNames, dataLines, skippedHeader } = useMemo(
    () => parseRows(text),
    [text],
  );
  const diff = useMemo(() => {
    const cur = new Set(currentNames);
    const pastedNames = new Set(parsed.map((p) => p.name));
    return {
      add: parsed.filter((p) => !cur.has(p.name)),
      update: parsed.filter((p) => cur.has(p.name)),
      del: currentNames.filter((n) => !pastedNames.has(n)),
    };
  }, [parsed, currentNames]);

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const res = await bulkReplaceInventoryAction(JSON.stringify(parsed));
      if (!res.ok) {
        setError(res.error ?? "반영에 실패했어요.");
        setBusy(false);
        return;
      }
      setResult(`갱신 ${res.updated} · 신규 ${res.added} · 삭제 ${res.deleted}건 반영됐어요.`);
      setText("");
      setConfirming(false);
      setBusy(false);
      router.refresh();
    } catch {
      setError("반영 중 문제가 생겼어요. 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="section-label" style={{ margin: "0 0 8px" }}>
        엑셀에서 한번에 붙여넣기
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>
        엑셀에서 <b>품목명 · 수량 · 공급가</b> 3열을 복사해 아래에 붙여넣으세요.
      </p>
      <textarea
        className="input"
        style={{ minHeight: 116, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 13, lineHeight: 1.5 }}
        placeholder={"사과\t20\t3000\n대파\t5\t1500\n양배추\t8\t2200"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setConfirming(false);
          setResult(null);
          setError("");
        }}
      />

      {result && (
        <div className="notice notice--ai" style={{ marginTop: 10 }}>
          ✓ {result}
        </div>
      )}
      {error && (
        <div className="notice notice--error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      {parsed.length > 0 && (
        <>
          <div className="bulkdiff">
            <span className="badge badge--mute">신규 {diff.add.length}</span>
            <span className="badge badge--mute">갱신 {diff.update.length}</span>
            <span className={`badge ${diff.del.length ? "badge--danger" : "badge--mute"}`}>
              삭제 {diff.del.length}
            </span>
          </div>

          <div className="notice notice--mute" style={{ marginTop: 10 }}>
            붙여넣은 {dataLines}줄 → 품목 <b>{parsed.length}개</b>
            {skippedHeader && " · 헤더 줄 자동 제외"}
            {dupNames.length > 0 && (
              <>
                <br />
                같은 품목명 <b>{dupNames.length}개는 첫 줄만</b> 반영돼요(아래 줄은 무시):{" "}
                {dupNames.slice(0, 20).join(", ")}
                {dupNames.length > 20 ? " …" : ""}
              </>
            )}
          </div>

          <div className="bulkprev">
            {parsed.slice(0, 60).map((p, i) => {
              const isNew = !currentNames.includes(p.name);
              return (
                <div className="bulkprev__row" key={i}>
                  <span className="bulkprev__name">
                    {p.name}
                    {isNew && <span className="bulkprev__tag">신규</span>}
                  </span>
                  <span className="bulkprev__qty">{p.qty}</span>
                  <span className="bulkprev__price">
                    {p.supplyPrice.toLocaleString("ko-KR")}원
                  </span>
                </div>
              );
            })}
            {parsed.length > 60 && (
              <div className="hint" style={{ padding: "6px 2px" }}>
                …외 {parsed.length - 60}개
              </div>
            )}
          </div>

          {diff.del.length > 0 && (
            <div className="notice notice--error" style={{ marginTop: 10 }}>
              ⚠ 붙여넣기에 없는 <b>{diff.del.length}개 품목이 삭제</b>돼요:{" "}
              {diff.del.slice(0, 20).join(", ")}
              {diff.del.length > 20 ? " …" : ""}
            </div>
          )}

          {!confirming ? (
            <button
              type="button"
              className="btn btn--primary btn--block"
              style={{ marginTop: 12 }}
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              미리보기 확인 · {parsed.length}개
            </button>
          ) : (
            <div className="confirm" style={{ marginTop: 12 }}>
              <div className="confirm__title">정말 이대로 전체 교체할까요?</div>
              <p className="confirm__hint">
                신규 {diff.add.length} · 갱신 {diff.update.length} · 삭제 {diff.del.length}건.
                되돌릴 수 없어요.
              </p>
              <div className="confirm__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={apply}
                  disabled={busy}
                >
                  {busy ? "반영 중…" : "네, 반영합니다"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
