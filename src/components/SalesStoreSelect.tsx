"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

// 매출 페이지 지점 필터 — 선택 시 ?store= 붙여 이동(다른 파라미터 유지).
export function SalesStoreSelect({
  stores,
  value,
}: {
  stores: { id: string; storeName: string }[];
  value: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();
  return (
    <select
      className="input"
      value={value}
      onChange={(e) => {
        const p = new URLSearchParams(sp.toString());
        if (e.target.value) p.set("store", e.target.value);
        else p.delete("store");
        router.push(`${path}?${p.toString()}`);
      }}
      style={{ minWidth: 120 }}
    >
      <option value="">전 지점</option>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.storeName}
        </option>
      ))}
    </select>
  );
}
