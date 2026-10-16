import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { merchantPlanView, PLAN_CATS } from "@/lib/order-plan";
import { isWindowKey, normalizeWindowKey } from "@/lib/schedule";
import { labelDate } from "@/lib/date";
import { CAT_LABEL } from "../../_lib/types";
import "../../order-plan.css";

export const dynamic = "force-dynamic";

// 점주 화면 미리보기 — 그 발주창에 점주가 볼 편성(읽기 전용). 특정 지점이 아닌 '처음 보는 지점' 기준.
export default async function OrderPlanPreviewPage({ params }: { params: Promise<{ date: string }> }) {
  await requireAdmin();
  const { date: raw } = await params;
  const norm = normalizeWindowKey(raw);
  if (norm !== raw && isWindowKey(norm)) redirect(`/admin/order-plan/${norm}/preview`);
  if (!isWindowKey(raw)) redirect("/admin/order-plan");
  const date = raw;
  const view = await merchantPlanView(date, "");

  return (
    <>
      <Topbar backHref={`/admin/order-plan/${date}`} title="점주 화면 미리보기" />
      <div className="page oplan">
        <div className="oplan-pv__head">
          <b>{labelDate(date)} 발주창</b>
          <Link href={`/admin/order-plan/${date}`} className="tbtn">
            편집으로 →
          </Link>
        </div>
        <div className="notice notice--mute" style={{ marginBottom: 12 }}>
          점주가 이 창에 보게 될 품목이에요(읽기 전용). 남은 수량은 지금 기준이에요.
        </div>

        {PLAN_CATS.map((c) => {
          const v = view.cats[c];
          return (
            <section className="card oplan-pv" key={c}>
              <div className="oplan-pv__title">
                {CAT_LABEL[c]}
                <span>{v.items.length}개</span>
              </div>
              {v.items.length === 0 ? (
                <div className="oplan-pv__closed">오늘은 {CAT_LABEL[c]} 발주 품목이 없어요.</div>
              ) : (
                <ul className="oplan-pv__list">
                  {v.items.map((it) => {
                    const soldOut = it.remaining !== null && it.remaining <= 0;
                    return (
                      <li key={it.id} className={soldOut ? "is-soldout" : ""}>
                        <div className="oplan-pv__name">
                          {it.name}
                          {soldOut && <span className="oplan-tag oplan-tag--mute">품절</span>}
                        </div>
                        {it.description && <div className="oplan-pv__desc">{it.description}</div>}
                        <div className="oplan-pv__meta">
                          {it.remaining !== null ? <span>남은 {it.remaining}개</span> : <span>수량 제한 없음</span>}
                          {it.maxPerStore !== null && <span>최대 {it.maxPerStore}개</span>}
                          {it.minPerStore !== null && <span>최소 {it.minPerStore}개</span>}
                          {it.linked && <span>재고 연동</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        <section className="card oplan-pv">
          <div className="oplan-pv__title">
            채움채
            <span>{view.tofu.visible.length}개</span>
          </div>
          {view.tofu.visible.length === 0 ? (
            <div className="oplan-pv__closed">오늘은 채움채 발주 품목이 없어요.</div>
          ) : (
            <ul className="oplan-pv__list">
              {view.tofu.visible.map((p) => (
                <li key={p.seq}>
                  <div className="oplan-pv__name">{p.name}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
