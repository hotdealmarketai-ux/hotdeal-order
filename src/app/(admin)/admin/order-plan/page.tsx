import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getRestrictConfig } from "@/lib/restrict-mode";
import { nextWindowKey, windowKeyAt } from "@/lib/schedule";
import { dowOf, labelDate, shipmentDayOf, shiftDate } from "@/lib/date";
import { OrderPlanModeCard } from "@/components/OrderPlanModeCard";
import { modeCardInfo, upcomingKeys, windowStatuses } from "./_lib/plan-data";
import { CAT_LABEL, CAT_SHORT, ITEM_CATS, type CatState } from "./_lib/types";
import "./order-plan.css";

export const dynamic = "force-dynamic";

const WEEK = ["월", "화", "수", "목", "금", "토", "일"];

function monthOf(m: string | undefined, fallback: string): { y: number; mo: number } {
  const hit = /^(\d{4})-(\d{2})$/.exec(m ?? "");
  if (hit) {
    const y = Number(hit[1]);
    const mo = Number(hit[2]);
    if (y >= 2024 && y <= 2100 && mo >= 1 && mo <= 12) return { y, mo };
  }
  return { y: Number(fallback.slice(0, 4)), mo: Number(fallback.slice(5, 7)) };
}
const ym = (y: number, mo: number) => `${y}-${String(mo).padStart(2, "0")}`;
const ymd = (y: number, mo: number, d: number) => `${ym(y, mo)}-${String(d).padStart(2, "0")}`;

function catText(s: CatState): string {
  return s.state === "some" ? `${s.count}개` : s.state === "closed" ? "닫힘" : "비어 있음";
}

// 발주 품목 편성 — 월 달력(발주창 키 기준). 칸 = 월~토, 일요일은 '토요일 창'으로 흐리게.
export default async function OrderPlanCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  await requireAdmin();
  const { m } = await searchParams;
  const cur = windowKeyAt();
  const tomorrow = nextWindowKey(cur);
  const { y, mo } = monthOf(m, cur);

  const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lead = (dowOf(ymd(y, mo, 1)) + 6) % 7; // 월요일 시작
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(ymd(y, mo, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const checkKeys = upcomingKeys(7, cur);
  const monthKeys = cells.filter((c): c is string => !!c && dowOf(c) !== 0);
  const [cfg, st] = await Promise.all([getRestrictConfig(), windowStatuses([...monthKeys, ...checkKeys])]);
  const info = modeCardInfo(cfg);

  const prevM = mo === 1 ? ym(y - 1, 12) : ym(y, mo - 1);
  const nextM = mo === 12 ? ym(y + 1, 1) : ym(y, mo + 1);
  const urgent = (k: string) => k === cur || k === tomorrow;

  return (
    <>
      <Topbar backHref="/admin" title="발주 품목 편성" />
      <div className="page oplan">
        <OrderPlanModeCard info={info} />

        <div className="card oplan-cal">
          <div className="oplan-cal__head">
            <Link href={`/admin/order-plan?m=${prevM}`} className="oplan-cal__nav" aria-label="이전 달">
              ‹
            </Link>
            <b>
              {y}년 {mo}월
            </b>
            <Link href={`/admin/order-plan?m=${nextM}`} className="oplan-cal__nav" aria-label="다음 달">
              ›
            </Link>
          </div>
          <div className="oplan-cal__legend">
            <span className="oplan-dot oplan-dot--some" /> 품목 수
            <span className="oplan-dot oplan-dot--closed" /> 0개=닫힘
            <span className="oplan-dot oplan-dot--none" /> 비어 있음
            <span className="oplan-dot oplan-dot--alert" /> 오늘·내일 빔
          </div>
          <div className="oplan-cal__grid">
            {WEEK.map((w, i) => (
              <div key={w} className={`oplan-cal__dow ${i === 5 ? "is-sat" : i === 6 ? "is-sun" : ""}`}>
                {w}
              </div>
            ))}
            {cells.map((c, i) => {
              if (!c) return <div key={`e${i}`} className="oplan-day oplan-day--empty" />;
              const d = Number(c.slice(8, 10));
              const dow = dowOf(c);
              if (dow === 0) {
                const sat = shiftDate(c, -1);
                return (
                  <Link key={c} href={`/admin/order-plan/${sat}`} className="oplan-day oplan-day--sun">
                    <span className="oplan-day__num">{d}</span>
                    <span className="oplan-day__sub">토요일 창</span>
                  </Link>
                );
              }
              const s = st[c];
              const past = c < cur;
              const ship = shipmentDayOf(c);
              return (
                <Link
                  key={c}
                  href={`/admin/order-plan/${c}`}
                  className={`oplan-day ${past ? "is-past" : ""} ${c === cur ? "is-today" : ""} ${dow === 6 ? "is-sat" : ""}`}
                >
                  <span className="oplan-day__num">{d}</span>
                  <span className="oplan-day__cats">
                    {ITEM_CATS.map((k) => {
                      const cs = s.cats[k];
                      const tone = cs.state === "none" ? (urgent(c) ? "alert" : "none") : cs.state;
                      return (
                        <span key={k} className={`oplan-mini oplan-mini--${tone}`} title={`${CAT_LABEL[k]} ${catText(cs)}`}>
                          {CAT_SHORT[k]}
                          {cs.state === "some" ? cs.count : cs.state === "closed" ? "0" : "·"}
                        </span>
                      );
                    })}
                    <span
                      className={`oplan-mini oplan-mini--${s.tofu.exists ? "some" : "none"}`}
                      title={`채움채 ${s.tofu.visible}/${s.tofu.total}`}
                    >
                      {CAT_SHORT.TOFU}
                      {s.tofu.visible}
                    </span>
                  </span>
                  <span className="oplan-day__sub">
                    {dow === 6 ? (
                      <>
                        토·일 발주
                        <br />→ 월 출고
                      </>
                    ) : (
                      <>→ {Number(ship.slice(8, 10))}일 출고</>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="oplan-cal__foot">
            <Link href={`/admin/order-plan?m=${ym(Number(cur.slice(0, 4)), Number(cur.slice(5, 7)))}`} className="tbtn">
              이번 달로
            </Link>
            <Link href={`/admin/order-plan/${cur}`} className="tbtn">
              오늘 발주창 편성 →
            </Link>
          </div>
        </div>

        <div className="section-label" style={{ marginTop: 18 }}>
          다음 7개 발주창 편성 점검
        </div>
        <div className="oplan-check7">
          {checkKeys.map((k) => {
            const s = st[k];
            const blank = ITEM_CATS.filter((c) => s.cats[c].state === "none");
            return (
              <Link key={k} href={`/admin/order-plan/${k}`} className={`oplan-check7__row ${blank.length ? "is-warn" : ""}`}>
                <span className="oplan-check7__date">
                  <b>{labelDate(k)}</b>
                  <small>
                    {k === cur ? "지금 발주창 · " : ""}
                    {dowOf(k) === 6 ? "토·일 발주 → 월 출고" : `→ ${labelDate(shipmentDayOf(k))} 출고`}
                  </small>
                </span>
                <span className="oplan-check7__cats">
                  {ITEM_CATS.map((c) => (
                    <span
                      key={c}
                      className={`oplan-chip oplan-chip--${s.cats[c].state === "none" ? (urgent(k) ? "alert" : "none") : s.cats[c].state}`}
                    >
                      {CAT_LABEL[c]} {catText(s.cats[c])}
                    </span>
                  ))}
                  <span className={`oplan-chip oplan-chip--${s.tofu.exists ? "some" : "none"}`}>
                    채움채 {s.tofu.visible}/{s.tofu.total}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
        <p className="oplan-hint">
          비어 있는 종류는 그날 점주 화면에서 닫혀요(채움채만 비어 있으면 4개 모두 보여요). 일요일은 토요일 발주창과 같은 창이에요.
        </p>
      </div>
    </>
  );
}
