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
            {closed ? "내 발주" : "내 예약"} {p.myQty}개
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
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const closed = useNow() >= p.closeAtMs;
  const max = p.available; // = 전체가용 + 내 현재수량

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
          {!closed && (
            <>
              {" "}· 남은 <b>{Math.max(0, max - qty)}개</b>
            </>
          )}
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
              <span className="rstep__val">{qty}</span>
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

// 점주 예약발주 단일 목록 — 검색 + '오늘 마감'/'마감 여유' 섹터. 각 섹터는 마감 임박순+ㄱㄴㄷ(서버 정렬).
export function FlatReservationMerchant({ products }: { products: FlatMerchantCard[] }) {
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
