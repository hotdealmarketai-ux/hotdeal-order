"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { kstToday } from "@/lib/date";

// 관리자 계산서 발행 진입 — 일반발주(날짜 직접 선택, 같은 날짜 무한 발행) / 주간발주(그 주 관리로).
export function BillingLauncher({ userId, canWeekly }: { userId: string; canWeekly: boolean }) {
  const router = useRouter();
  const [date, setDate] = useState(kstToday());

  return (
    <div className="stack">
      <div className="card">
        <div className="resv-dates__field">
          <span>일반발주 계산서 · 출고 기준일</span>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn--primary btn--block"
          style={{ marginTop: 12 }}
          disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}
          onClick={() => router.push(`/admin/invoices/new?user=${userId}&date=${date}`)}
        >
          일반발주 계산서 발행
        </button>
        <p className="resv-note">같은 날짜로 여러 장(부분·추가) 발행할 수 있어요.</p>
      </div>

      {canWeekly && (
        <div className="card">
          <div className="resv-card__title" style={{ marginBottom: 4 }}>
            주간발주 계산서
          </div>
          <p className="resv-note" style={{ marginTop: 0 }}>
            그 주(週) 주간발주 기준으로 발행합니다.
          </p>
          <button
            type="button"
            className="btn btn--soft btn--block"
            style={{ marginTop: 10 }}
            onClick={() => router.push(`/admin/weekly/${userId}`)}
          >
            주간발주 계산서 발행
          </button>
        </div>
      )}
    </div>
  );
}
