"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  COURIERS,
  STATUS_LABEL,
  STATUS_ORDER,
  type ShipmentStatus,
} from "@/lib/couriers";
import {
  addShipmentAction,
  deleteShipmentAction,
  refreshShipmentsAction,
} from "@/app/actions/shipment";

export type ShipmentRow = {
  id: string;
  trackingNo: string;
  courierCode: string;
  courierName: string;
  itemName: string;
  qty: number;
  status: string;
  statusText: string;
  lastCheckedAt: string | null;
};

// ERROR(조회 실패)는 '집하전' 섹션에 함께 둔다(아직 추적 안 된 것 취급).
function bucketOf(s: ShipmentRow): ShipmentStatus {
  return s.status === "ERROR" ? "PRE_PICKUP" : (s.status as ShipmentStatus);
}
function timeLabel(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ShipmentManager({
  shipments,
  apiConfigured,
}: {
  shipments: ShipmentRow[];
  apiConfigured: boolean;
}) {
  const router = useRouter();
  const [courierCode, setCourierCode] = useState(COURIERS[0].code);
  const [trackingNo, setTrackingNo] = useState("");
  const [itemName, setItemName] = useState("");
  const [qty, setQty] = useState("1");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  const autoDone = useRef(false);

  const doRefresh = () => {
    setRefreshing(true);
    start(async () => {
      await refreshShipmentsAction();
      setRefreshing(false);
      router.refresh();
    });
  };

  // 진입 시 1회 자동 조회(키 있고, 활성 송장 있을 때) — 목록을 실시간 상태로 맞춘다.
  useEffect(() => {
    if (autoDone.current) return;
    autoDone.current = true;
    if (apiConfigured && shipments.some((s) => s.status !== "DELIVERED")) {
      doRefresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = () => {
    setErr("");
    if (!trackingNo.trim()) return setErr("송장번호를 입력하세요.");
    start(async () => {
      const fd = new FormData();
      fd.set("courierCode", courierCode);
      fd.set("trackingNo", trackingNo.trim());
      fd.set("itemName", itemName.trim());
      fd.set("qty", qty || "1");
      const r = await addShipmentAction(fd);
      if (r?.error) {
        setErr(r.error);
        return;
      }
      setTrackingNo("");
      setItemName("");
      setQty("1");
      router.refresh();
    });
  };

  const remove = (id: string) => {
    if (!confirm("이 송장을 삭제할까요?")) return;
    start(async () => {
      const fd = new FormData();
      fd.set("id", id);
      await deleteShipmentAction(fd);
      router.refresh();
    });
  };

  const byStatus = (st: ShipmentStatus) => shipments.filter((s) => bucketOf(s) === st);

  return (
    <>
      {/* 등록 폼 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-label" style={{ marginBottom: 8 }}>
          송장 등록
        </div>
        <select
          className="input"
          value={courierCode}
          onChange={(e) => setCourierCode(e.target.value)}
          style={{ marginBottom: 8 }}
          aria-label="택배사"
        >
          {COURIERS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={trackingNo}
          onChange={(e) => setTrackingNo(e.target.value.replace(/[^\dA-Za-z-]/g, ""))}
          placeholder="송장번호"
          inputMode="numeric"
          style={{ marginBottom: 8 }}
        />
        <input
          className="input"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          placeholder="품목명 (선택)"
          maxLength={100}
          style={{ marginBottom: 8 }}
        />
        <input
          className="input"
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
          placeholder="수량"
          inputMode="numeric"
          style={{ marginBottom: 10 }}
        />
        {err && <div className="notice notice--error" style={{ marginBottom: 8 }}>{err}</div>}
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={add}
          disabled={pending}
        >
          {pending ? "처리 중…" : "송장 등록"}
        </button>
      </div>

      {!apiConfigured && (
        <div className="notice notice--ai" style={{ marginBottom: 14 }}>
          택배 조회 API 키가 아직 설정되지 않아 상태는 자동 갱신되지 않습니다. (키 등록 후 실시간 조회)
        </div>
      )}

      <div className="shiptop">
        <span className="shiptop__hint">
          {refreshing ? "택배 상태 조회 중…" : "등록된 송장을 실시간 조회해 4단계로 구분합니다."}
        </span>
        <button
          type="button"
          className="btn btn--xs btn--soft"
          onClick={doRefresh}
          disabled={refreshing || pending}
        >
          새로고침
        </button>
      </div>

      {/* 4개 섹션 */}
      {STATUS_ORDER.map((st) => {
        const list = byStatus(st);
        return (
          <section className={`shipsec shipsec--${st.toLowerCase()}`} key={st}>
            <div className="shipsec__head">
              <span className="shipsec__label">{STATUS_LABEL[st]}</span>
              <span className="shipsec__count">{list.length}</span>
            </div>
            {list.length === 0 ? (
              <div className="shipsec__empty">해당 상태의 송장이 없어요.</div>
            ) : (
              <div className="shipwrap">
                {list.map((s) => (
                  <div className="shipcard" key={s.id}>
                    <div className="shipcard__main">
                      <div className="shipcard__name">
                        {s.itemName || "품목 미입력"}
                        <span className="shipcard__qty">{s.qty}개</span>
                      </div>
                      <div className="shipcard__meta">
                        {s.courierName} · {s.trackingNo}
                      </div>
                      <div className="shipcard__state">
                        {s.status === "ERROR" ? "조회 실패" : STATUS_LABEL[st]}
                        {s.statusText ? ` · ${s.statusText}` : ""}
                        {s.lastCheckedAt ? ` · ${timeLabel(s.lastCheckedAt)} 조회` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shipcard__del"
                      onClick={() => remove(s.id)}
                      aria-label="송장 삭제"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
