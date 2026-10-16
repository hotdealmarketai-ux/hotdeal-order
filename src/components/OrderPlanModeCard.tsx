"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sheet } from "./Sheet";
import { ConfirmSheet } from "./ConfirmSheet";
import { restrictPreflightAction, setRestrictModeAction } from "@/app/actions/order-plan";
import {
  CAT_LABEL,
  ITEM_CATS,
  type ModeCardInfo,
  type PreflightResult,
  type PreflightWindow,
} from "@/app/(admin)/admin/order-plan/_lib/types";

type Pre = Extract<PreflightResult, { ok: true }>;

// 품목 제한 모드 스위치 카드 — /admin/order-plan 맨 위와 일반 발주 관리 맨 위에 같은 카드.
// 켜기: 확인 시트(body 포탈)에서 준비 상태 점검 → [다음 발주창부터(기본) / 지금 바로] + 시험 지점. 끄기: 확인 한 번.
export function OrderPlanModeCard({ info, showLink = false }: { info: ModeCardInfo; showLink?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState(false);
  const [askOff, setAskOff] = useState(false);
  const [pre, setPre] = useState<Pre | null>(null);
  const [err, setErr] = useState("");
  const [when, setWhen] = useState<"next" | "now">("next");
  const [pilotOnly, setPilotOnly] = useState(false);
  const [pilot, setPilot] = useState<string[]>([]);

  const status = !info.on
    ? "꺼짐"
    : info.active
      ? "켜짐"
      : "켜짐 예약";
  const sub = !info.on
    ? "점주는 지금처럼 자유롭게 발주해요."
    : [
        info.from ? `${info.fromLabel} 발주창부터` : "지금 발주창부터",
        info.pilotCount > 0 ? `시험 지점 ${info.pilotCount}곳` : "전 지점",
      ].join(" · ");

  const openOn = () => {
    setErr("");
    setPre(null);
    setWhen("next");
    setPilotOnly(false);
    setPilot([]);
    setAsk(true);
    start(async () => {
      const r = await restrictPreflightAction().catch(() => ({ ok: false as const, error: "점검 정보를 불러오지 못했어요." }));
      if (!r.ok) setErr(r.error);
      else setPre(r);
    });
  };

  const apply = (on: boolean) => {
    setErr("");
    start(async () => {
      const res = await setRestrictModeAction({ on, when, pilot: on && pilotOnly ? pilot : [] }).catch(() => ({
        error: "스위치를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.",
      }));
      if (res?.error) {
        setErr(res.error);
        return;
      }
      setAsk(false);
      router.refresh();
    });
  };

  const close = () => {
    if (pending) return;
    setAsk(false);
  };

  const blankCats = (w: PreflightWindow) => ITEM_CATS.filter((c) => w.cats[c].state === "none");
  const canTurnOn = !!pre && !(pilotOnly && pilot.length === 0);

  return (
    <>
      <div className={`card oplan-mode ${info.on ? "is-on" : ""}`}>
        <div className="oplan-mode__main">
          <div className="oplan-mode__title">
            품목 제한 모드
            <span className={`oplan-mode__state ${info.on ? "is-on" : ""}`}>{status}</span>
          </div>
          <div className="oplan-mode__sub">{sub}</div>
          {showLink && (
            <Link href="/admin/order-plan" className="oplan-mode__link">
              발주 품목 편성 달력 →
            </Link>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={info.on}
          aria-label="품목 제한 모드"
          className={`switch ${info.on ? "is-on" : ""}`}
          disabled={pending}
          onClick={() => (info.on ? setAskOff(true) : openOn())}
        >
          <span className="switch__knob" />
        </button>
      </div>
      {err && !ask && (
        <div className="notice notice--error" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}

      {askOff && (
        <ConfirmSheet
          title="품목 제한 모드를 끌까요? 점주는 바로 자유 발주로 돌아가요."
          confirmLabel="끄기"
          onConfirm={() => apply(false)}
          onClose={() => setAskOff(false)}
        />
      )}

      {ask && (
        <Sheet onClose={close}>
          <div className="sheet__panel" style={{ maxWidth: 520 }}>
            <div className="sheet__head">
              <div className="sheet__title">품목 제한 모드 켜기</div>
              <button type="button" className="sheet__close" aria-label="닫기" onClick={close}>
                ✕
              </button>
            </div>
            <div className="sheet__body oplan-pre">
              {!pre && !err && <div className="oplan-pre__loading">준비 상태를 확인하고 있어요…</div>}
              {err && <div className="notice notice--error">{err}</div>}
              {pre && (
                <>
                  <p className="oplan-pre__lead">
                    켜면 점주는 편성한 품목만 발주할 수 있어요. 재고현황·예약발주 메뉴는 숨겨지고, 채팅 발주는 잠겨요.
                  </p>
                  {pre.windows.map((w) => {
                    const blank = blankCats(w);
                    return (
                      <div className="oplan-pre__win" key={w.key}>
                        <div className="oplan-pre__wh">
                          <b>{w.label}</b>
                          <span>{w.key === pre.nowKey ? "지금 발주창" : "다음 발주창"}</span>
                          <Link href={`/admin/order-plan/${w.key}`} className="tbtn" onClick={() => setAsk(false)}>
                            편성하기
                          </Link>
                        </div>
                        <div className="oplan-pre__cats">
                          {ITEM_CATS.map((c) => {
                            const s = w.cats[c];
                            return (
                              <span key={c} className={`oplan-chip oplan-chip--${s.state === "none" ? "alert" : s.state}`}>
                                {CAT_LABEL[c]} {s.state === "some" ? `${s.count}개` : s.state === "closed" ? "닫힘" : "비어 있음"}
                              </span>
                            );
                          })}
                          <span className="oplan-chip oplan-chip--some">
                            채움채 {w.tofu.visible}/{w.tofu.total}
                          </span>
                        </div>
                        {blank.length > 0 && (
                          <div className="oplan-pre__warn">
                            {blank.map((c) => CAT_LABEL[c]).join("·")} 편성이 비어 있어 그 창엔 점주가 발주할 수 없어요.
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <ul className="oplan-pre__facts">
                    <li>
                      지금 발주창 재고현황 담기 <b>{pre.cartHolds}건</b>({pre.cartStores}곳)
                    </li>
                    <li>
                      진행 중 예약상품 <b>{pre.activeReservations}개</b> — 확정된 예약분은 공구에 그대로 흘러가요.
                    </li>
                    <li>
                      지금 발주창에 이미 들어온 발주 <b>{pre.windowOrders}건</b>
                    </li>
                  </ul>

                  <div className="section-label" style={{ marginTop: 14 }}>
                    언제부터
                  </div>
                  <div className="oplan-radio">
                    <label className={when === "next" ? "is-on" : ""}>
                      <input type="radio" name="when" checked={when === "next"} onChange={() => setWhen("next")} />
                      <span>
                        <b>다음 발주창부터</b> (추천)
                        <small>{pre.windows.find((w) => w.key === pre.nextKey)?.label ?? pre.nextKey} 발주창부터 적용</small>
                      </span>
                    </label>
                    <label className={when === "now" ? "is-on" : ""}>
                      <input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} />
                      <span>
                        <b>지금 바로</b>
                        <small>이미 들어온 발주는 그대로 두고, 새로 넣는 것부터 제한해요.</small>
                      </span>
                    </label>
                  </div>

                  <label className="oplan-check" style={{ marginTop: 12 }}>
                    <input type="checkbox" checked={pilotOnly} onChange={(e) => setPilotOnly(e.target.checked)} />
                    <span>시험 지점만 먼저 켜기</span>
                  </label>
                  {pilotOnly && (
                    <div className="oplan-pilot">
                      {pre.merchants.length === 0 && <div className="oplan-pre__loading">가맹점이 없어요.</div>}
                      {pre.merchants.map((m) => (
                        <label key={m.id} className={`oplan-pilot__opt ${pilot.includes(m.id) ? "is-on" : ""}`}>
                          <input
                            type="checkbox"
                            checked={pilot.includes(m.id)}
                            onChange={(e) =>
                              setPilot((p) => (e.target.checked ? [...p, m.id] : p.filter((x) => x !== m.id)))
                            }
                          />
                          <span>{m.storeName}</span>
                        </label>
                      ))}
                      {pilot.length === 0 && <div className="oplan-pre__warn">시험할 지점을 하나 이상 골라 주세요.</div>}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="sheet__foot">
              <button type="button" className="btn btn--ghost" onClick={close} disabled={pending}>
                취소
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => apply(true)}
                disabled={pending || !canTurnOn}
              >
                {pending && pre ? "적용 중…" : "켜기"}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
