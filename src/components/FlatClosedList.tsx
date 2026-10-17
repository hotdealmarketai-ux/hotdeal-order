"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFlatProductAction } from "@/app/actions/reservation-flat";
import { labelShipment } from "@/lib/date";
import { FlatProductForm, type FlatFormRow, type FlatInv } from "./FlatProductForm";
import { FlatAdminLine, FlatLineErr, FlatMsg } from "./FlatReservationAdmin";
import { ConfirmSheet } from "./ConfirmSheet";

export type FlatClosedRow = FlatFormRow & {
  closeAtLabel: string; // "M월 D일 HH:MM" 등 서버 포맷
  totalQty: number;
  storeCount: number;
};

// 마감된 예약 / 출고 지난 공산품 공용 목록 — 상단 검색 + 마감 지난 상품(최근 마감순).
// 지난 상품도 '수정/삭제' 가능(서버 액션은 지난 상품 허용 — closeAt만 있으면 됨). [복사]는 그 값으로 새 상품 등록.
// 폼은 진행 중 목록과 같은 부품(FlatProductForm) — 수정·복사를 눌렀을 때만 열린다.
export function FlatClosedList({
  rows,
  inventoryItems,
  emptyText,
}: {
  rows: FlatClosedRow[];
  inventoryItems: FlatInv[];
  emptyText: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [load, setLoad] = useState<{ row: FlatClosedRow; copy: boolean; seq: number } | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string; warning?: string } | null>(null);
  // 삭제가 막히면 그 상품 줄 바로 밑에(목록이 길면 맨 위 안내는 화면 밖이라 못 본다)
  const [lineErr, setLineErr] = useState<{ id: string; text: string } | null>(null);
  const [askDel, setAskDel] = useState<FlatClosedRow | null>(null);
  const [pending, start] = useTransition();

  const shown = useMemo(() => {
    const query = q.trim();
    return query ? rows.filter((r) => r.name.includes(query)) : rows;
  }, [q, rows]);

  const open = (row: FlatClosedRow, copy: boolean) => {
    setMsg(null);
    setLineErr(null);
    setLoad((l) => ({ row, copy, seq: (l?.seq ?? 0) + 1 }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const del = (p: FlatClosedRow) => {
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

  return (
    <>
      {load && (
        <FlatProductForm
          key={load.seq}
          inventoryItems={inventoryItems}
          initial={{ row: load.row, copy: load.copy }}
          allowNew={false}
          onClose={(m) => {
            setLoad(null);
            setMsg(m ?? null);
          }}
        />
      )}
      <FlatMsg msg={msg} />

      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="상품 검색"
        style={{ margin: "12px 0" }}
      />
      {shown.length === 0 ? (
        <div className="empty">
          <p>{q.trim() ? "검색 결과가 없어요." : emptyText}</p>
        </div>
      ) : (
        <div className="resvflatwrap">
          {shown.map((p) => (
            <Fragment key={p.id}>
              <FlatAdminLine
                p={p}
                pending={pending}
                closeText={`${labelShipment(p.pickupDate)} · ${p.closeAtLabel} 마감`}
                onEdit={() => open(p, false)}
                onCopy={() => open(p, true)}
                onDelete={() => setAskDel(p)}
              />
              {lineErr?.id === p.id && <FlatLineErr text={lineErr.text} />}
            </Fragment>
          ))}
        </div>
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
