import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

// [임시·읽기전용] AFC 야채크래커 출고 취합 — 발행된 모든 계산서(ISSUED/PAID)에서 '야채크래커' 품목만.
// 관리자 세션만. 리포트 뽑은 뒤 이 라우트는 제거한다.
export const dynamic = "force-dynamic";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["ISSUED", "PAID"] } },
    select: {
      id: true,
      date: true,
      kind: true,
      status: true,
      issuedAt: true,
      user: { select: { storeName: true } },
      items: { select: { name: true, qty: true, unit: true, category: true } },
    },
  });

  type Row = { date: string; store: string; name: string; qty: number; unit: string; kind: string; status: string; invoiceId: string };
  const rows: Row[] = [];
  for (const inv of invoices) {
    for (const it of inv.items) {
      if (norm(it.name).includes("야채크래커")) {
        rows.push({
          date: inv.date,
          store: inv.user?.storeName ?? "(알수없음)",
          name: it.name,
          qty: it.qty,
          unit: it.unit || "",
          kind: inv.kind,
          status: inv.status,
          invoiceId: inv.id,
        });
      }
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.store.localeCompare(b.store));

  // REFUND(환불)은 반품이라 '나간 것' 합계에서 제외해 별도로 표기.
  const outRows = rows.filter((r) => r.kind !== "REFUND");
  const refundRows = rows.filter((r) => r.kind === "REFUND");
  const total = outRows.reduce((s, r) => s + (r.qty || 0), 0);

  const byStore: Record<string, number> = {};
  for (const r of outRows) byStore[r.store] = (byStore[r.store] ?? 0) + (r.qty || 0);
  const byDate: Record<string, number> = {};
  for (const r of outRows) byDate[r.date] = (byDate[r.date] ?? 0) + (r.qty || 0);

  return NextResponse.json(
    {
      generatedFor: "AFC 야채크래커 출고 취합",
      matchedNames: [...new Set(rows.map((r) => r.name))],
      count: outRows.length,
      totalQty: total,
      byStore,
      byDate,
      rows: outRows,
      refundRows,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
