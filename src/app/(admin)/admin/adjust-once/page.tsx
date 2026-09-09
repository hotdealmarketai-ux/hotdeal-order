// [임시·1회용] 재고 임의 차감 확인 페이지 — 현재 재고를 보여주고, [적용]을 눌러야 차감된다.
// 변경 기록·감사 로그를 남기지 않는다. 사용 후 이 페이지와 lib/action을 함께 제거한다.
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { resolveAdjustOnce, type AdjustStatus } from "@/lib/adjust-once";
import { applyAdjustOnceAction } from "@/app/actions/adjust-once";
import { SubmitButton } from "@/components/SubmitButton";

const STATUS_LABEL: Record<AdjustStatus, string> = {
  ok: "적용 가능",
  not_found: "품목 못 찾음",
  ambiguous: "이름 중복 — 특정 불가",
  negative: "재고 부족(음수)",
};

export default async function AdjustOncePage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const rows = await resolveAdjustOnce();
  const allOk = rows.every((r) => r.status === "ok");

  return (
    <>
      <Topbar backHref="/admin" title="재고 임의 차감 (1회)" />
      <div className="page">
        {sp.done ? (
          <div className="card" style={{ borderColor: "var(--ok, #16a34a)" }}>
            <b>적용 완료</b> — 아래 수량으로 차감되었습니다. (기록 없음)
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {rows.map((r, i) => (
            <div className="card" key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <b style={{ minWidth: 0 }}>{r.matchedName ?? r.target.name}</b>
                <span style={{ color: r.status === "ok" ? "var(--muted)" : "var(--danger)", whiteSpace: "nowrap", fontSize: 13 }}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              <div style={{ marginTop: 6, color: "var(--muted)" }}>
                {r.currentQty == null ? (
                  <span>요청: {r.target.name} · −{r.target.deduct}</span>
                ) : (
                  <span>
                    {r.currentQty}개 <b style={{ color: "var(--black)" }}>→ {r.afterQty}개</b>{" "}
                    <span style={{ fontSize: 13 }}>(−{r.target.deduct})</span>
                  </span>
                )}
              </div>
              {r.status === "ambiguous" && r.candidates.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 13, color: "var(--danger)" }}>
                  후보: {r.candidates.join(" / ")}
                </div>
              )}
            </div>
          ))}
        </div>

        {!sp.done && (
          <form action={applyAdjustOnceAction} style={{ marginTop: 14 }}>
            <input type="hidden" name="confirm" value="APPLY" />
            <SubmitButton className="btn btn--primary btn--block" pendingText="적용 중…" disabled={!allOk}>
              적용
            </SubmitButton>
            {!allOk && (
              <p className="lead" style={{ marginTop: 8, color: "var(--danger)" }}>
                모든 품목이 “적용 가능” 상태여야 실행됩니다.
              </p>
            )}
          </form>
        )}
      </div>
    </>
  );
}
