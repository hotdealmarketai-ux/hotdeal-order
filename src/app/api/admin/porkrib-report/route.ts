// ⚠ 임시(1회성) 관리자 조회 라우트 — 오늘 발행 계산서에서 '돼지갈비찜' 관련 내역 리포트용.
// 읽기 전용·관리자 세션 게이트. 리포트 뽑은 뒤 제거한다.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { kstToday, kstDayRange } from "@/lib/date";

export const dynamic = "force-dynamic";

const norm = (s: string) => (s ?? "").replace(/\s+/g, "");

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const today = kstToday();
  const { start, end } = kstDayRange(today);

  // '오늘 발행(issuedAt)' 또는 '출고일(date)=오늘' 인 계산서(초안 제외) 전부 조회 후 품목명 부분일치.
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { not: "DRAFT" },
      OR: [{ issuedAt: { gte: start, lt: end } }, { date: today }],
    },
    select: {
      id: true,
      date: true,
      kind: true,
      status: true,
      issuedAt: true,
      user: { select: { storeName: true } },
      items: {
        select: {
          name: true,
          qty: true,
          unit: true,
          unitPrice: true,
          amount: true,
          category: true,
          tax: true,
        },
      },
    },
    orderBy: [{ issuedAt: "asc" }, { date: "asc" }],
  });

  const rows: Array<Record<string, unknown>> = [];
  let totalQty = 0;
  let totalAmount = 0;
  let spicyQty = 0;
  let spicyAmount = 0;
  let plainQty = 0;
  let plainAmount = 0;

  for (const inv of invoices) {
    for (const it of inv.items) {
      if (!norm(it.name).includes("돼지갈비찜")) continue;
      const spicy = norm(it.name).includes("매운");
      rows.push({
        store: inv.user?.storeName ?? "",
        issuedAt: inv.issuedAt,
        date: inv.date, // 출고일
        kind: inv.kind,
        status: inv.status,
        category: it.category,
        name: it.name,
        spicy,
        qty: it.qty,
        unit: it.unit,
        unitPrice: it.unitPrice,
        amount: it.amount,
        tax: it.tax,
        invoiceId: inv.id,
      });
      totalQty += it.qty;
      totalAmount += it.amount;
      if (spicy) {
        spicyQty += it.qty;
        spicyAmount += it.amount;
      } else {
        plainQty += it.qty;
        plainAmount += it.amount;
      }
    }
  }

  return NextResponse.json({
    today,
    invoicesScanned: invoices.length,
    matchCount: rows.length,
    summary: {
      total: { qty: totalQty, amount: totalAmount },
      "매운 돼지갈비찜": { qty: spicyQty, amount: spicyAmount },
      "돼지갈비찜(일반)": { qty: plainQty, amount: plainAmount },
    },
    rows,
  });
}
