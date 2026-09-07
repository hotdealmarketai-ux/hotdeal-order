import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

// ⚠ 임시(1회성) 읽기전용 진단 — '김치흑돼지피자' 계산서 나간 내역 조회. 확인 후 제거.
// SELECT 만. 관리자 세션 필수. 어떤 데이터도 변경하지 않는다.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // 피자+흑돼지 조합, 또는 '김치흑돼지'(공백무관) 를 폭넓게 잡는다.
  const items = await prisma.invoiceItem.findMany({
    where: {
      OR: [
        { AND: [{ name: { contains: "피자" } }, { name: { contains: "흑돼지" } }] },
        { name: { contains: "김치흑돼지" } },
      ],
    },
    select: {
      name: true,
      qty: true,
      unitPrice: true,
      amount: true,
      unit: true,
      category: true,
      invoice: {
        select: {
          id: true,
          date: true,
          kind: true,
          status: true,
          issuedAt: true,
          user: { select: { storeName: true, username: true } },
        },
      },
    },
  });

  const rows = items.map((it) => ({
    store: it.invoice.user.storeName,
    username: it.invoice.user.username,
    date: it.invoice.date,
    kind: it.invoice.kind,
    status: it.invoice.status,
    issuedAt: it.invoice.issuedAt ? it.invoice.issuedAt.toISOString() : null,
    name: it.name,
    qty: it.qty,
    unit: it.unit,
    unitPrice: it.unitPrice,
    amount: it.amount,
    invoiceId: it.invoice.id,
  }));
  // 출고일(date) 최신순
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // 요약: 매칭된 품목명 종류 / 상태별 / 발행분(ISSUED+PAID) 합계
  const byName: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let issuedQty = 0;
  let issuedAmount = 0;
  for (const r of rows) {
    byName[r.name] = (byName[r.name] ?? 0) + 1;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.status === "ISSUED" || r.status === "PAID") {
      issuedQty += r.qty;
      issuedAmount += r.amount;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      totalRows: rows.length,
      matchedNames: byName,
      byStatus,
      issuedQtySum: issuedQty,
      issuedAmountSum: issuedAmount,
      rows,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
