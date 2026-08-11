"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { kstToday } from "@/lib/date";

// 관리자 계산서 발행 진입 — 일반발주(날짜 직접 선택, 같은 날짜 무한 발행).
// 주간발주 계산서는 추후 일반과 통합 예정이라 지금은 노출하지 않음.
export function BillingLauncher({ userId }: { userId: string }) {
  const router = useRouter();
  const [date, setDate] = useState(kstToday());

  return (
    <div className="stack">
      <div className="card">
        <div className="resv-dates__field">
          <span>출고 기준일</span>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn btn--primary"
            style={{ flex: 1 }}
            disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}
            onClick={() => router.push(`/admin/invoices/new?user=${userId}&date=${date}`)}
          >
            계산서 발행
          </button>
          {/* 환불계산서 — 미수 차감용. 카테고리·재고 없이 자유 입력. 빨강. */}
          <button
            type="button"
            className="btn btn--refund"
            style={{ flex: 1 }}
            onClick={() => router.push(`/admin/billing/${userId}/refund`)}
          >
            환불계산서 발행
          </button>
        </div>
        {/* 사다드림 계산서 — 우리 계좌가 아닌 개인/개인업체 결제. 전체 미수와 분리된 '사다드림 미수' 별도 트랙. */}
        <button
          type="button"
          className="btn btn--soft btn--block"
          style={{ marginTop: 8 }}
          onClick={() => router.push(`/admin/billing/${userId}/sadadream`)}
        >
          사다드림 발행
        </button>
      </div>
    </div>
  );
}
