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
        <button
          type="button"
          className="btn btn--primary btn--block"
          style={{ marginTop: 12 }}
          disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}
          onClick={() => router.push(`/admin/invoices/new?user=${userId}&date=${date}`)}
        >
          계산서 발행
        </button>
      </div>
    </div>
  );
}
