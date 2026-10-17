"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmFlatProductAction, holdFlatProductAction } from "@/app/actions/reservation-flat";
import type { FlatMerchantRow, FlatMyOrderRow } from "@/lib/reservation-flat";
import { flatQtyProblem, qtyRuleBadges, stepDown, stepUp, type FlatQtyRule } from "@/lib/flat-qty-rule";
import { closeAtLabel, closeRemain, groupFlatByClose } from "@/lib/flat-group";
import { labelShipment } from "@/lib/date";
import { ConfirmSheet } from "./ConfirmSheet";

// 점주 공산품 카드 데이터 = 서버 목록 행 그대로(listFlatProductsMerchant). 타입만 가져온다(서버 전용 파일).
export type FlatMerchantCard = FlatMerchantRow;

const won = (n: number) => n.toLocaleString("ko-KR");

// 1초마다 갱신되는 현재시각 — 마감 경계에서 버튼이 바로 잠기고 남은 시간이 흐르도록.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// 숫자 고르는 중(draft) — base = 고르기 시작할 때의 저장 수량. 서버 값이 바뀌면(저장·본사 수정) base 가 달라져
// 저절로 버려진다 → 저장 직후 새로고침이 올 때까지는 고른 숫자를 그대로 보여 깜빡이지 않는다.
type Draft = { qty: number; base: number };

// 점주 공산품 목록 — 마감 시각 묶음 → 그 안 출고일 → 1열 카드. 검색·'발주한 것만'은 화면 안에서 거른다.
// −/+·직접 입력은 숫자만 바꾸고, 서버는 [발주하기]/[변경 저장]/[발주 취소] 때 한 번 부른다.
// closedList = 마감된 공산품(최근 마감순, 수량 칸 없이 '내 발주 N개'만).
export function FlatReservationMerchant({
  products,
  myOrders,
  closedList = false,
}: {
  products: FlatMerchantCard[];
  myOrders?: FlatMyOrderRow[];
  closedList?: boolean;
}) {
  const router = useRouter();
  const now = useNow();
  const [q, setQ] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [leave, setLeave] = useState<string | null>(null);

  const draftOf = (p: FlatMerchantCard) => {
    const d = drafts[p.id];
    return d && d.base === p.myQty ? d.qty : p.myQty;
  };
  const setDraft = (p: FlatMerchantCard, qty: number) =>
    setDrafts((s) => ({ ...s, [p.id]: { qty, base: p.myQty } }));
  const isDirty = (p: FlatMerchantCard) => now < p.closeAtMs && draftOf(p) !== p.myQty;
  const dirty = !closedList && products.some(isDirty);

  // 저장 안 한 숫자가 있는 채 떠나려 하면 — 새로고침·창 닫기는 브라우저 확인, 화면 안 링크(하단 메뉴 포함)는 확인 창.
  //  링크 클릭을 React·Next Link 보다 먼저(window 캡처 단계) 받아 멈춘다.
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setLeave(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", onBefore);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBefore);
      window.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const query = q.trim();
  const shown = products.filter(
    (p) => (!query || p.name.includes(query)) && (!mineOnly || p.myQty > 0 || isDirty(p)),
  );
  const groups = groupFlatByClose(shown, closedList ? "desc" : "asc");

  return (
    <>
      <div className="gsp-tools">
        <input
          className="input input--compact"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="상품 검색"
        />
        <button
          type="button"
          className={`gsp-filter${mineOnly ? " is-on" : ""}`}
          aria-pressed={mineOnly}
          onClick={() => setMineOnly((v) => !v)}
        >
          발주한 것만
        </button>
      </div>

      {myOrders && myOrders.length > 0 && <MyOrders rows={myOrders} />}

      {groups.length === 0 ? (
        <div className="empty">
          <p>
            {query
              ? "검색 결과가 없어요."
              : mineOnly
                ? "발주한 공산품이 없어요."
                : closedList
                  ? "마감된 공산품이 없어요."
                  : "지금 발주할 수 있는 공산품이 없어요."}
          </p>
        </div>
      ) : (
        groups.map((g) => {
          const remain = closeRemain(g.closeAtMs, now);
          // 묶음 머리 = 규칙(5개부터·5개씩)·안내만. 규칙 없는 건 기본이라 따로 적지 않는다.
          const common = [...(g.commonRule ? qtyRuleBadges(g.commonRule) : []), g.commonDesc ?? ""].filter(Boolean);
          return (
            <section className="gsp-group" key={g.closeAtMs}>
              <div className="gsp-ghead">
                <div className="gsp-ghead__when">
                  <span className="gsp-ghead__at">{closeAtLabel(g.closeAtMs)} 마감</span>
                  {!closedList && (
                    <span className={`gsp-ghead__left is-${remain.tone}`} suppressHydrationWarning>
                      {remain.text}
                    </span>
                  )}
                </div>
                {common.length > 0 && <div className="gsp-ghead__common">{common.join(" · ")}</div>}
              </div>
              {g.ships.map((s) => (
                <div key={s.pickupDate}>
                  <div className="gsp-ship">{labelShipment(s.pickupDate)}</div>
                  <div className="gsp-cards">
                    {s.items.map((p) => (
                      <FlatCard
                        key={p.id}
                        p={p}
                        now={now}
                        draft={draftOf(p)}
                        onDraft={(n) => setDraft(p, n)}
                        showRule={g.commonRule === null}
                        showDesc={g.commonDesc === null}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })
      )}

      {leave && (
        <ConfirmSheet
          title="저장 안 한 변경을 버릴까요?"
          confirmLabel="버리고 이동"
          onConfirm={() => router.push(leave)}
          onClose={() => setLeave(null)}
        />
      )}
    </>
  );
}

// 맨 위 접이식 '내 발주 N건 · 금액' — 출고일이 오늘 이후인 내 확정 줄(= 출고·계산서로 나가는 것)
function MyOrders({ rows }: { rows: FlatMyOrderRow[] }) {
  const [open, setOpen] = useState(false);
  const total = rows.reduce((s, r) => s + r.qty * r.supplyPrice, 0);
  // 서버가 출고일 → ㄱㄴㄷ 로 정렬해 준다 — 출고일 바뀌는 곳에서만 나눈다.
  const byDate = useMemo(() => {
    const out: { date: string; items: FlatMyOrderRow[] }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.date === r.pickupDate) last.items.push(r);
      else out.push({ date: r.pickupDate, items: [r] });
    }
    return out;
  }, [rows]);
  return (
    <div className="gsp-mine">
      <button type="button" className="gsp-mine__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>
          내 발주 <b>{rows.length}건</b> · <b>{won(total)}원</b>
        </span>
        <span aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="gsp-mine__body">
          {byDate.map((d) => (
            <div key={d.date}>
              <div className="gsp-mine__date">{labelShipment(d.date)}</div>
              {d.items.map((r) => (
                <div className="gsp-mine__row" key={`${r.productId}:${r.pickupDate}`}>
                  <span>{r.name}</span>
                  <span>
                    {r.qty}
                    {r.isSet ? "세트" : "개"} · {won(r.qty * r.supplyPrice)}원
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 상품 카드 1장 — 정보 + [−] 수량 [+] + 상태·버튼. 상태는 값만으로 정한다(서버 계약 2-3).
function FlatCard({
  p,
  now,
  draft,
  onDraft,
  showRule,
  showDesc,
}: {
  p: FlatMerchantCard;
  now: number;
  draft: number;
  onDraft: (n: number) => void;
  showRule: boolean; // 묶음 머리에 규칙이 없을 때만 카드에 배지
  showDesc: boolean; // 묶음 머리에 안내가 없을 때만 카드에 안내
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [typing, setTyping] = useState<string | null>(null); // 입력칸 타이핑 중 글자(빈칸 허용)
  const [compOpen, setCompOpen] = useState(false);

  const rule: FlatQtyRule = { minPerStore: p.minPerStore, qtyStep: p.qtyStep };
  const unit = p.isSet ? "세트" : "개";
  const closed = now >= p.closeAtMs;
  const step = p.qtyStep > 1 ? p.qtyStep : 1;
  // 재고 고정(연동)이면 남은 수량(내 수량 포함)까지만 — 이미 그보다 많이 넣어 둔 수량은 줄이기만.
  const max = p.hasLinked && p.stockFixed ? Math.max(p.available, p.myQty) : 99999;
  const badges = showRule ? qtyRuleBadges(rule) : [];
  const stockLeft = Math.max(0, p.available - draft);

  // 규칙 검사 — 기준은 지금 나가고 있는 내 수량(확정분). 몰래 고치지 않고 칸을 빨갛게 + 맞는 숫자 버튼.
  const ruleMsg = flatQtyProblem(draft, p.myConfirmedQty, rule);
  const over = draft > max && draft > p.myQty;
  const problem = ruleMsg ?? (over ? `남은 수량이 부족해요 (최대 ${max}${unit})` : null);
  const valid = (n: number) => n > 0 && n <= max && flatQtyProblem(n, p.myConfirmedQty, rule) === null;
  const fitDown = (n: number) => (flatQtyProblem(n, p.myConfirmedQty, rule) ? stepDown(n, rule) : n);
  const fixes = !problem
    ? []
    : [...new Set(ruleMsg ? [stepDown(draft, rule), stepUp(draft, rule)] : [fitDown(max)])].filter(valid);
  const up = stepUp(draft, rule);
  // 숫자를 다시 고르면 지난 저장 오류는 지운다.
  const change = (n: number) => {
    setErr("");
    onDraft(n);
  };

  // 상태 → 칩 + 버튼
  let chip: { text: string; tone: "ok" | "warn" | "bad" } | null = null;
  let action: "order" | "save" | "cancel" | null = null;
  if (closed) {
    if (p.myConfirmedQty > 0) chip = { text: `내 발주 ${p.myConfirmedQty}${unit}`, tone: "ok" };
  } else if (p.myQty > 0 && draft === 0) {
    action = "cancel";
  } else if (p.myConfirmed) {
    if (draft === p.myQty) chip = { text: `발주됨 ${p.myQty}${unit}`, tone: "ok" };
    else {
      chip = { text: `저장 전 · 기존 ${p.myQty}${unit}`, tone: "warn" };
      action = "save";
    }
  } else {
    if (p.myQty > 0) chip = { text: "발주 전", tone: "bad" };
    action = "order";
  }

  const run = () => {
    const qty = draft;
    setErr("");
    start(async () => {
      // 재고연동(단일·세트) = 담기+확정 한 번에, 수기 = 저장+확정. 0 = 발주 취소(줄 삭제).
      const r = p.hasLinked
        ? await holdFlatProductAction({ productId: p.id, qty, confirm: true })
        : await confirmFlatProductAction({ productId: p.id, qty });
      if (!r.ok) {
        // 실패해도 새로 읽는다 — 남은 수량·마감이 바뀌었으면 카드 숫자·빠른 고침 버튼이 서버와 맞게(고른 숫자는 유지)
        setErr(r.error ?? "저장에 실패했어요. 다시 시도해 주세요.");
        router.refresh();
        return;
      }
      router.refresh();
    });
  };

  // 왼쪽 띠 색 — 규칙 어김(빨강) · 고른 숫자가 아직 저장 안 됨(주황) · 발주됨(초록)
  const tone = closed
    ? "is-closed"
    : problem
      ? "is-bad"
      : draft !== p.myQty
        ? "is-dirty"
        : chip?.tone === "ok"
          ? "is-on"
          : "";
  const cls = tone ? `gsp-card ${tone}` : "gsp-card";

  return (
    <div className={cls}>
      <div className="gsp-card__name">
        {p.name}
        {p.isSet && <span className="gsp-card__tag">세트</span>}
      </div>
      <div className="gsp-card__price">
        <b>{won(p.supplyPrice)}원</b>
        {step > 1 && (
          <>
            {" "}· {step}
            {unit} {won(p.supplyPrice * step)}원
          </>
        )}
      </div>
      {(badges.length > 0 || (p.hasLinked && !closed)) && (
        <div className="gsp-card__badges">
          {badges.map((b) => (
            <span className="gsp-badge gsp-badge--rule" key={b}>
              {b}
            </span>
          ))}
          {p.hasLinked &&
            !closed &&
            (stockLeft > 0 ? (
              <span className="gsp-badge gsp-badge--left">
                남은 {stockLeft}
                {unit}
              </span>
            ) : (
              <span className="gsp-badge gsp-badge--out">
                {p.stockFixed ? "재고 소진" : "재고 소진 · 발주 가능"}
              </span>
            ))}
        </div>
      )}
      {showDesc && p.description && <div className="gsp-card__desc">{p.description}</div>}
      {p.isSet && p.components.length > 0 && (
        <>
          <button
            type="button"
            className="gsp-card__compbtn"
            aria-expanded={compOpen}
            onClick={() => setCompOpen((v) => !v)}
          >
            구성품 {p.components.length}개 {compOpen ? "▲" : "▼"}
          </button>
          {compOpen && (
            <div className="gsp-card__comp">
              {p.components.map((c) => `${c.name} ×${c.qtyPerUnit}`).join(" · ")}
            </div>
          )}
        </>
      )}

      {!closed && (
        <div className="gsp-card__qty">
          <div className={`gsp-step${problem ? " is-bad" : ""}`} role="group" aria-label={`${p.name} 수량`}>
            <button
              type="button"
              className="gsp-step__btn"
              aria-label="수량 줄이기"
              disabled={pending || draft <= 0}
              onClick={() => change(stepDown(draft, rule))}
            >
              −
            </button>
            <input
              className="gsp-step__val"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label={`${p.name} 발주 수량`}
              placeholder="0"
              value={typing ?? (draft > 0 ? String(draft) : "")}
              disabled={pending}
              onFocus={(e) => {
                setTyping(draft > 0 ? String(draft) : "");
                e.currentTarget.select();
              }}
              onChange={(e) => {
                const s = e.target.value.replace(/\D/g, "").slice(0, 5);
                setTyping(s);
                change(s ? parseInt(s, 10) : 0);
              }}
              onBlur={() => setTyping(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <button
              type="button"
              className="gsp-step__btn"
              aria-label="수량 늘리기"
              disabled={pending || up > max}
              onClick={() => change(up)}
            >
              +
            </button>
          </div>
          {draft > 0 && <span className="gsp-card__sum">= {won(draft * p.supplyPrice)}원</span>}
        </div>
      )}

      {!closed && problem && (
        <div className="gsp-card__msg">
          <div>{problem}</div>
          {fixes.length > 0 && (
            <div className="gsp-card__fixes">
              {fixes.map((n) => (
                <button type="button" className="gsp-card__fix" key={n} onClick={() => change(n)}>
                  {n}
                  {unit}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {(chip || action) && (
        <div className="gsp-card__foot">
          {chip && <span className={`gsp-state gsp-state--${chip.tone}`}>{chip.text}</span>}
          {action && (
            <button
              type="button"
              className={`btn btn--sm ${action === "cancel" ? "btn--danger" : "btn--primary"}`}
              disabled={pending || (action !== "cancel" && (draft <= 0 || !!problem))}
              onClick={run}
            >
              {pending
                ? action === "cancel"
                  ? "취소 중…"
                  : "저장 중…"
                : action === "cancel"
                  ? "발주 취소"
                  : action === "save"
                    ? "변경 저장"
                    : "발주하기"}
            </button>
          )}
        </div>
      )}
      {/* 새로 읽은 뒤 같은 내용이 위 규칙·남은 수량 안내로 뜨면 겹쳐 보이지 않게 그쪽만 */}
      {err && !problem && <div className="gsp-card__err">{err}</div>}
    </div>
  );
}
