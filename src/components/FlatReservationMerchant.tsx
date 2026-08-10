"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmFlatProductAction,
  unlockFlatProductAction,
  holdFlatProductAction,
} from "@/app/actions/reservation-flat";

export type FlatMerchantCard = {
  id: string;
  name: string;
  pickupDate: string;
  supplyPrice: number;
  inventoryItemId: string;
  closeAtMs: number;
  myQty: number;
  myConfirmed: boolean;
  available: number;
  stockFixed: boolean; // 재고 고정(초과발주 금지). false면 재고 넘어 담기 가능.
};

const won = (n: number) => n.toLocaleString("ko-KR");

// ms → KST 달력 날짜(YYYY-MM-DD). '오늘 마감' 섹터 분리에 사용.
function kstDateStr(ms: number): string {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 1초마다 갱신되는 현재시각 — 마감 경계에서 버튼이 실시간으로 잠기도록.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function remain(ms: number, now: number): string {
  let s = Math.floor((ms - now) / 1000);
  if (s <= 0) return "마감";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return `${d}일 ${h}시간 ${m}분 남음`;
  return `${h}시간 ${m}분 ${s}초 남음`;
}

function Countdown({ ms }: { ms: number }) {
  const now = useNow();
  const closed = now >= ms;
  return (
    <span className={closed ? "rcard__cd rcard__cd--closed" : "rcard__cd"}>
      {remain(ms, now)}
    </span>
  );
}

// 수기 상품 카드 — 수량 입력 + 발주 확정 / 수정(잠금해제) / 마감
function ManualCard({ p }: { p: FlatMerchantCard }) {
  const router = useRouter();
  const [qty, setQty] = useState(String(p.myQty || ""));
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const closed = useNow() >= p.closeAtMs;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setErr("");
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErr(r.error ?? "실패했어요.");
        return;
      }
      router.refresh();
    });
  };
  const n = Math.max(0, parseInt(qty.replace(/[^\d]/g, "") || "0", 10) || 0);

  return (
    <div className="rcard">
      <div className="rcard__name">{p.name}</div>
      <Countdown ms={p.closeAtMs} />
      <div className="rcard__info">
        <div>
          픽업 <b>{p.pickupDate}</b>
        </div>
        <div>
          공급가 <b>{won(p.supplyPrice)}원</b>
        </div>
        {p.myQty > 0 && (!p.myConfirmed || closed) && (
          <div className="rcard__mine">
            {closed ? "내 발주" : "내 예약"} <b>{p.myQty}</b>개
          </div>
        )}
      </div>

      <div className="rcard__act">
        {closed ? (
          <button className="btn btn--sm btn--ghost" disabled>
            마감
          </button>
        ) : p.myConfirmed ? (
          <>
            <span className="rcard__done">예약 {p.myQty}개 · 확정됨</span>
            <button
              className="btn btn--sm btn--soft"
              disabled={pending}
              onClick={() => run(() => unlockFlatProductAction({ productId: p.id }))}
            >
              수정
            </button>
          </>
        ) : (
          <>
            <input
              className="input input--compact rcard__qty"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
              placeholder="수량"
              aria-label={`${p.name} 수량`}
            />
            <button
              className="btn btn--sm btn--primary"
              disabled={pending || (n === 0 && p.myQty === 0)}
              onClick={() => run(() => confirmFlatProductAction({ productId: p.id, qty: n }))}
            >
              {n === 0 && p.myQty > 0 ? "예약 취소" : `발주 확정${n > 0 ? ` (${n}개)` : ""}`}
            </button>
          </>
        )}
      </div>
      {err && <div className="rcard__err">{err}</div>}
    </div>
  );
}

// 재고연동 상품 카드 — 실시간 −/+ 담기(재고 홀드)로 수량 조절 후 '발주 확정'. 수기와 동일한 확정/수정 흐름.
function LinkedCard({ p }: { p: FlatMerchantCard }) {
  const router = useRouter();
  const [qty, setQty] = useState(p.myQty);
  const [draft, setDraft] = useState<string | null>(null); // 입력칸 타이핑 중 임시값(포커스 아웃 시 커밋)
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const closed = useNow() >= p.closeAtMs;
  // 재고 고정이면 재고(전체가용+내수량)까지만. 기본(초과발주 허용)이면 상한 없음(큰 값).
  const max = p.stockFixed ? p.available : 99999;
  const stockLeft = Math.max(0, p.available - qty); // 재고 기준 남은수량(0에서 바닥)

  // 담기 = 재고 홀드(qty)만. 확정은 별도 버튼.
  const hold = (next: number) => {
    const v = Math.max(0, Math.min(max, next));
    if (v === qty) return;
    setQty(v);
    setErr("");
    start(async () => {
      const r = await holdFlatProductAction({ productId: p.id, qty: v });
      if (!r.ok) {
        setErr(r.error ?? "실패했어요.");
        setQty(p.myQty); // 롤백
        return;
      }
      router.refresh();
    });
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setErr("");
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErr(r.error ?? "실패했어요.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="rcard">
      <div className="rcard__name">
        {p.name}
        <span className="rcard__tag">재고연동</span>
      </div>
      <Countdown ms={p.closeAtMs} />
      <div className="rcard__info">
        <div>
          픽업 <b>{p.pickupDate}</b>
        </div>
        <div>
          공급가 <b>{won(p.supplyPrice)}원</b>
          {!closed &&
            (stockLeft > 0 ? (
              <>
                {" "}· 남은 <b>{stockLeft}개</b>
              </>
            ) : p.stockFixed ? (
              <>
                {" "}· <b>재고 소진</b>
              </>
            ) : (
              <>
                {" "}· 재고 소진(추가 주문 가능)
              </>
            ))}
        </div>
        {/* 확정분만 '내 발주'로 표시 — 미확정 담기는 마감 후 자동 해제되므로 발주로 오인시키지 않는다. */}
        {closed && p.myConfirmed && p.myQty > 0 && (
          <div className="rcard__mine">내 발주 {p.myQty}개</div>
        )}
      </div>

      <div className="rcard__act">
        {closed ? (
          <button className="btn btn--sm btn--ghost" disabled>
            마감
          </button>
        ) : p.myConfirmed ? (
          <>
            <span className="rcard__done">예약 {p.myQty}개 · 확정됨</span>
            <button
              className="btn btn--sm btn--soft"
              disabled={pending}
              onClick={() => run(() => unlockFlatProductAction({ productId: p.id }))}
            >
              수정
            </button>
          </>
        ) : (
          <>
            <div className="rstep">
              <button
                className="rstep__btn"
                disabled={pending || qty <= 0}
                onClick={() => hold(qty - 1)}
                aria-label="빼기"
              >
                −
              </button>
              <input
                className="rstep__input"
                inputMode="numeric"
                value={draft ?? String(qty)}
                onChange={(e) =>
                  setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 5))
                }
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => {
                  if (draft === null) return; // 타이핑 안 했으면 그대로
                  const n = parseInt(draft || "0", 10) || 0;
                  setDraft(null);
                  hold(n); // 담기(홀드)로 커밋 — 재고 상한 클램프·미변경 시 무동작
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                aria-label={`${p.name} 예약 수량`}
              />
              <button
                className="rstep__btn"
                disabled={pending || qty >= max}
                onClick={() => hold(qty + 1)}
                aria-label="담기"
              >
                +
              </button>
            </div>
            <button
              className="btn btn--sm btn--primary"
              disabled={pending || qty <= 0}
              onClick={() => run(() => confirmFlatProductAction({ productId: p.id, qty }))}
            >
              발주 확정{qty > 0 ? ` (${qty}개)` : ""}
            </button>
          </>
        )}
      </div>
      {err && <div className="rcard__err">{err}</div>}
    </div>
  );
}

function renderCard(p: FlatMerchantCard) {
  return p.inventoryItemId ? (
    <LinkedCard key={`${p.id}:${p.myQty}:${p.myConfirmed}:${p.available}`} p={p} />
  ) : (
    <ManualCard key={`${p.id}:${p.myQty}:${p.myConfirmed}`} p={p} />
  );
}

// 점주 예약발주 목록 — 검색 + (진행 중일 때만) '오늘 마감'/'마감 여유' 섹터.
// sectioned=false(지난 예약 마감)면 이미 다 마감돼 '마감 여유'가 무의미하므로 섹터 없이 단일 리스트.
export function FlatReservationMerchant({
  products,
  sectioned = true,
}: {
  products: FlatMerchantCard[];
  sectioned?: boolean;
}) {
  const [q, setQ] = useState("");
  const now = useNow();
  const query = q.trim();
  const shown = query ? products.filter((p) => p.name.includes(query)) : products;

  const todayStr = kstDateStr(now);
  const todayList = shown.filter((p) => kstDateStr(p.closeAtMs) === todayStr);
  const laterList = shown.filter((p) => kstDateStr(p.closeAtMs) !== todayStr);

  return (
    <>
      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="상품 검색"
        style={{ marginBottom: 12 }}
      />
      {shown.length === 0 ? (
        <div className="empty">
          <p>{query ? "검색 결과가 없어요." : "예약 가능한 상품이 없어요."}</p>
        </div>
      ) : !sectioned ? (
        <div className="rcardwrap">{shown.map(renderCard)}</div>
      ) : (
        <>
          {todayList.length > 0 && (
            <section className="rsec">
              <div className="rsec__head rsec__head--today">오늘 마감</div>
              <div className="rcardwrap">{todayList.map(renderCard)}</div>
            </section>
          )}
          {laterList.length > 0 && (
            <section className="rsec">
              <div className="rsec__head">마감 여유</div>
              <div className="rcardwrap">{laterList.map(renderCard)}</div>
            </section>
          )}
        </>
      )}
    </>
  );
}
