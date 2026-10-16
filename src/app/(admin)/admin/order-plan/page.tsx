import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getRestrictConfig } from "@/lib/restrict-mode";
import { nextWindowKey, windowKeyAt } from "@/lib/schedule";
import { dowOf, labelDate, shipmentDayOf, shiftDate } from "@/lib/date";
import { OrderPlanModeCard } from "@/components/OrderPlanModeCard";
import { OrderChannelCard } from "@/components/OrderChannelCard";
import { orderChannelConfig } from "@/lib/order-flags";
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

// 발주 시스템 관리 — 품목 제한 모드 스위치 + 발주 방식(칸·채팅) + 날짜별 품목 편성 월 달력(발주창 키 기준).
// 칸 = 월~토, 일요일은 토요일 발주창(흐리게). 옛 '일반 발주 관리'를 합쳤다.
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
  const [cfg, st, channel] = await Promise.all([
    getRestrictConfig(),
    windowStatuses([...monthKeys, ...checkKeys]),
    orderChannelConfig(),
  ]);
  const info = modeCardInfo(cfg);

  const prevM = mo === 1 ? ym(y - 1, 12) : ym(y, mo - 1);
  const nextM = mo === 12 ? ym(y + 1, 1) : ym(y, mo + 1);
  const urgent = (k: string) => k === cur || k === tomorrow;
  const isCurMonth = ym(y, mo) === cur.slice(0, 7);

  return (
    <>
      <Topbar backHref="/admin" title="발주 시스템 관리" />
      <div className="page oplan">
        <OrderPlanModeCard info={info} />
        <OrderChannelCard
          config={channel}
          restrict={{ on: cfg.on, allStores: cfg.pilot.length === 0, active: info.active }}
        />

        <div className="card oplan-cal">
          <div className="oplan-cal__head">
            <Link href={`/admin/order-plan?m=${prevM}`} className="oplan-cal__nav" aria-label="이전 달">
              ‹
            </Link>
            <span className="oplan-cal__title">
              <b>
                {y}년 {mo}월
              </b>
              {!isCurMonth && (
                <Link href="/admin/order-plan" className="tbtn">
                  이번 달
                </Link>
              )}
            </span>
            <Link href={`/admin/order-plan?m=${nextM}`} className="oplan-cal__nav" aria-label="다음 달">
              ›
            </Link>
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
                  <Link key={c} href={`/admin/order-plan/${sat}`} className="oplan-day oplan-day--sun" aria-label={`${d}일 — 토요일 발주창`}>
                    <span className="oplan-day__num">{d}</span>
                  </Link>
                );
              }
              const s = st[c];
              const past = c < cur;
              // 칸에는 편성한 종류만(품목 수, 0개=닫힘은 회색) — 비어 있는 종류는 표시하지 않고,
              // 오늘·내일 발주창에 비어 있는 종류가 있으면 '비어 있음' 한 줄로만 알린다.
              const planned = ITEM_CATS.filter((k) => s.cats[k].state !== "none");
              const alert = urgent(c) && planned.length < ITEM_CATS.length;
              return (
                <Link
                  key={c}
                  href={`/admin/order-plan/${c}`}
                  className={`oplan-day ${past ? "is-past" : ""} ${c === cur ? "is-today" : ""} ${dow === 6 ? "is-sat" : ""} ${alert ? "is-alert" : ""}`}
                >
                  <span className="oplan-day__num">{d}</span>
                  {(planned.length > 0 || s.tofu.exists) && (
                    <span className="oplan-day__cats">
                      {planned.map((k) => {
                        const cs = s.cats[k];
                        return (
                          <span key={k} className={`oplan-mini oplan-mini--${cs.state}`} title={`${CAT_LABEL[k]} ${catText(cs)}`}>
                            {CAT_SHORT[k]}
                            {cs.state === "some" ? cs.count : 0}
                          </span>
                        );
                      })}
                      {s.tofu.exists && (
                        <span className="oplan-mini oplan-mini--some" title={`채움채 ${s.tofu.visible}/${s.tofu.total}`}>
                          {CAT_SHORT.TOFU}
                          {s.tofu.visible}
                        </span>
                      )}
                    </span>
                  )}
                  {alert ? (
                    <span className="oplan-day__alert">비어 있음</span>
                  ) : (
                    dow === 6 && <span className="oplan-day__sub">→ 월 출고</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="section-label" style={{ marginTop: 18 }}>
          다음 7개 발주창
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
                    {k === cur ? "지금 · " : ""}
                    {dowOf(k) === 6 ? "토·일 발주 → 월 출고" : `→ ${labelDate(shipmentDayOf(k))} 출고`}
                  </small>
                </span>
                <span className="oplan-check7__cats">
                  {/* 편성한 종류만 칩으로, 비어 있는 종류는 한 칩으로 묶는다(오늘·내일이면 빨강) */}
                  {ITEM_CATS.filter((c) => s.cats[c].state !== "none").map((c) => (
                    <span key={c} className={`oplan-chip oplan-chip--${s.cats[c].state}`}>
                      {CAT_LABEL[c]} {catText(s.cats[c])}
                    </span>
                  ))}
                  {s.tofu.exists && (
                    <span className="oplan-chip oplan-chip--some">
                      채움채 {s.tofu.visible}/{s.tofu.total}
                    </span>
                  )}
                  {blank.length > 0 && (
                    <span className={`oplan-chip oplan-chip--${urgent(k) ? "alert" : "none"}`}>
                      {blank.length === ITEM_CATS.length && !s.tofu.exists
                        ? "편성 전"
                        : `${blank.map((c) => CAT_LABEL[c]).join("·")} 비어 있음`}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
