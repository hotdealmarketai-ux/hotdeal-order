// ⚠ 임시(1회성) 관리자 조회 라우트 — 발행 계산서에서 특정 품목명 나간 내역 리포트용.
// 읽기 전용·관리자 세션 게이트. 리포트 뽑은 뒤 제거한다.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }
  const q = (req.nextUrl.searchParams.get("name") ?? "").trim();
  if (!q) return NextResponse.json({ error: "name query required" }, { status: 400 });
  const key = norm(q);

  // 발행된 계산서(ISSUED/PAID)의 모든 품목 중 이름 정규화 부분일치.
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["ISSUED", "PAID"] } },
    select: {
      id: true,
      date: true,
      kind: true,
      status: true,
      issuedAt: true,
      user: { select: { storeName: true } },
      items: {
        select: { name: true, qty: true, unitPrice: true, amount: true, unit: true, category: true },
      },
    },
    orderBy: [{ date: "asc" }, { issuedAt: "asc" }],
  });

  const rows: Array<{
    date: string;
    store: string;
    kind: string;
    status: string;
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
    unit: string;
    category: string;
  }> = [];
  for (const inv of invoices) {
    for (const it of inv.items) {
      if (norm(it.name).includes(key)) {
        rows.push({
          date: inv.date,
          store: inv.user?.storeName ?? "",
          kind: inv.kind,
          status: inv.status,
          name: it.name,
          qty: it.qty,
          unitPrice: it.unitPrice,
          amount: it.amount,
          unit: it.unit ?? "",
          category: it.category,
        });
      }
    }
  }

  const totalQty = rows.reduce((n, r) => n + r.qty, 0);
  const totalAmount = rows.reduce((n, r) => n + r.amount, 0);
  // 단가별 집계(어떤 가격에 몇 번/몇 개)
  const byPrice: Record<string, { unitPrice: number; count: number; qty: number }> = {};
  for (const r of rows) {
    const k = String(r.unitPrice);
    (byPrice[k] ??= { unitPrice: r.unitPrice, count: 0, qty: 0 });
    byPrice[k].count += 1;
    byPrice[k].qty += r.qty;
  }

  return NextResponse.json({
    query: q,
    count: rows.length,
    totalQty,
    totalAmount,
    byPrice: Object.values(byPrice).sort((a, b) => a.unitPrice - b.unitPrice),
    rows,
  });
}
