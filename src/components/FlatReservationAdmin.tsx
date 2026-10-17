"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveFlatProductAction } from "@/app/actions/reservation-flat";
import { qtyRuleBadges } from "@/lib/flat-qty-rule";
import { closeAtLabel, closeRemain, groupFlatByClose } from "@/lib/flat-group";
import { labelShipment } from "@/lib/date";
import { FlatProductForm, type FlatFormRow, type FlatInv } from "./FlatProductForm";
import { ConfirmSheet } from "./ConfirmSheet";

// 진행 중 목록 행 = 폼에 채울 값 + 마감 시각(묶음) + 확정 집계.
export type FlatAdminRow = FlatFormRow & {
  closeAtMs: number;
  totalQty: number;
  storeCount: number;
};

const won = (n: number) => n.toLocaleString("ko-KR");

// 1초마다 갱신되는 현재시각 — 묶음 제목의 남은 시간용.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// 관리자 공산품 — 등록 폼(연속 등록·복사·알림 끄기) + 진행 중 목록(점주 화면과 같은 마감 시각 → 출고일 묶음).
export function FlatReservationAdmin({
  products,
  inventoryItems,
}: {
  products: FlatAdminRow[];
  inventoryItems: FlatInv[];
}) {
  const router = useRouter();
  const now = useNow();
  // 폼에 띄울 상품(수정·복사). seq 는 같은 상품을 다시 눌러도 폼을 새로 그리게 한다.
  const [load, setLoad] = useState<{ row: FlatAdminRow; copy: boolean; seq: number } | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string; warning?: string } | null>(null);
  // 삭제가 막히면 그 상품 줄 바로 밑에(목록이 길면 맨 위 안내는 화면 밖이라 못 본다)
  const [lineErr, setLineErr] = useState<{ id: string; text: string } | null>(null);
  const [askDel, setAskDel] = useState<FlatAdminRow | null>(null);
  const [pending, start] = useTransition();

  const open = (row: FlatAdminRow, copy: boolean) => {
    setMsg(null);
    setLineErr(null);
    setLoad((l) => ({ row, copy, seq: (l?.seq ?? 0) + 1 }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const del = (p: FlatAdminRow) => {
    setMsg(null);
    setLineErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("id", p.id);
      fd.set("deleted", "true");
      const res = await saveFlatProductAction({}, fd);
      if (res?.error) {
        setLineErr({ id: p.id, text: res.error });
        return;
      }
      if (load?.row.id === p.id && !load.copy) setLoad(null);
      setMsg({ ok: `'${p.name}' 삭제했어요.` });
      router.refresh();
    });
  };

  const groups = groupFlatByClose(products, "asc");

  return (
    <>
      <FlatProductForm
        key={load ? `${load.seq}` : "blank"}
        inventoryItems={inventoryItems}
        initial={load ? { row: load.row, copy: load.copy } : null}
        onClose={(m) => {
          setLoad(null);
          setMsg(m ?? null);
        }}
      />
      <FlatMsg msg={msg} />

      <div className="itemshead" style={{ marginTop: 16 }}>
        <span className="itemshead__label">진행 중 공산품</span>
        <span className="itemshead__count">{products.length}개</span>
      </div>
      {products.length === 0 ? (
        <div className="empty">
          <p>진행 중인 공산품이 없어요.</p>
        </div>
      ) : (
        groups.map((g) => {
          const remain = closeRemain(g.closeAtMs, now);
          return (
            <section className="gsp-group" key={g.closeAtMs}>
              <div className="gsp-ghead">
                <div className="gsp-ghead__when">
                  <span className="gsp-ghead__at">{closeAtLabel(g.closeAtMs)} 마감</span>
                  <span className={`gsp-ghead__left is-${remain.tone}`} suppressHydrationWarning>
                    {remain.text}
                  </span>
                </div>
              </div>
              {g.ships.map((s) => (
                <div key={s.pickupDate}>
                  <div className="gsp-ship">{labelShipment(s.pickupDate)}</div>
                  <div className="resvflatwrap">
                    {s.items.map((p) => (
                      <Fragment key={p.id}>
                        <FlatAdminLine
                          p={p}
                          pending={pending}
                          onEdit={() => open(p, false)}
                          onCopy={() => open(p, true)}
                          onDelete={() => setAskDel(p)}
                        />
                        {lineErr?.id === p.id && <FlatLineErr text={lineErr.text} />}
                      </Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })
      )}

      {askDel && (
        <ConfirmSheet
          title={`'${askDel.name}' 삭제할까요?`}
          onConfirm={() => del(askDel)}
          onClose={() => setAskDel(null)}
        />
      )}
    </>
  );
}

// 저장·삭제 결과 한 줄 — 오류(빨강) / 됐어요(초록) + 알릴 말(주황)
export function FlatMsg({ msg }: { msg: { ok?: string; error?: string; warning?: string } | null }) {
  if (!msg) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {msg.error && <div className="notice notice--error">{msg.error}</div>}
      {msg.ok && <div className="notice notice--ok">{msg.ok}</div>}
      {msg.warning && <div className="gsp-note gsp-note--warn">{msg.warning}</div>}
    </div>
  );
}

// 목록 줄 바로 밑 오류 한 줄(삭제가 막혔을 때) — 진행 중·마감된 목록 공용
export function FlatLineErr({ text }: { text: string }) {
  return (
    <div className="notice notice--error" style={{ margin: "6px 0 8px" }}>
      {text}
    </div>
  );
}

// 관리자 목록 한 줄 — 이름·공급가·수량 규칙·안내 + 확정 집계 + [수정][복사][삭제]. 진행 중·마감된 목록 공용.
export function FlatAdminLine({
  p,
  pending,
  closeText,
  onEdit,
  onCopy,
  onDelete,
}: {
  p: FlatFormRow & { totalQty: number; storeCount: number };
  pending: boolean;
  closeText?: string; // 마감된 목록에서만 — 묶음 없이 줄마다 '출고 … · … 마감'
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const badges = qtyRuleBadges({ minPerStore: p.minPerStore ?? null });
  return (
    <div className="resvflat">
      <Link href={`/admin/reservations/product/${p.id}`} className="resvflat__main">
        <div className="resvflat__name">
          {p.name}
          {p.components.length > 0 ? (
            <span className="resvflat__tag">세트</span>
          ) : p.inventoryItemId ? (
            <span className="resvflat__tag">재고 연동</span>
          ) : null}
        </div>
        <div className="resvflat__meta">
          공급가 {won(p.supplyPrice)}원
          {badges.map((b) => (
            <span className="resvflat__rule" key={b}>
              {b}
            </span>
          ))}
        </div>
        {p.description && <div className="resvflat__desc">{p.description}</div>}
        {closeText && <div className="resvflat__meta">{closeText}</div>}
        <div className="resvflat__meta2">
          <span className="resvflat__agg">
            총 {p.totalQty}개 · 지점 {p.storeCount}곳 ›
          </span>
        </div>
      </Link>
      <div className="resvflat__acts">
        <button type="button" className="btn btn--xs btn--soft" onClick={onEdit}>
          수정
        </button>
        <button type="button" className="btn btn--xs btn--soft" onClick={onCopy}>
          복사
        </button>
        <button type="button" className="btn btn--xs btn--ghost" onClick={onDelete} disabled={pending}>
          삭제
        </button>
      </div>
    </div>
  );
}
