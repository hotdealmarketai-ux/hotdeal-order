import { Topbar } from "@/components/Topbar";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  allowedCategoriesFor,
  CATEGORY_ORDER,
  isMerchant,
  type Category,
  type Role,
} from "@/lib/constants";
import { kstDayRange, labelDate, normalizeDateStr } from "@/lib/date";
import { InvoiceForm, type InvoiceRefGroup } from "@/components/InvoiceForm";

// 계산서 새로 작성 — 합본 발주서의 '계산서 작성' 버튼에서 진입
export default async function NewInvoicePage(props: {
  searchParams: Promise<{ user?: string; date?: string }>;
}) {
  await requireAdmin();
  const { user: userId = "", date: rawDate } = await props.searchParams;
  const date = normalizeDateStr(rawDate);

  const merchant = await prisma.user.findUnique({ where: { id: userId } });
  if (!merchant || !isMerchant(merchant.role as Role)) notFound();

  // 이미 이 날짜 계산서가 있으면(취소 제외) 그리로 이동
  const existing = await prisma.invoice.findFirst({
    where: { userId, date, status: { not: "VOID" } },
    select: { id: true },
  });
  if (existing) redirect(`/admin/invoices/${existing.id}`);

  // 그날 발주 내역 — 참고용(출고 기준으로 직접 입력하므로 자동 채움 안 함)
  const { start, end } = kstDayRange(date);
  const orders = await prisma.order.findMany({
    where: { userId, createdAt: { gte: start, lt: end } },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  const refMap = new Map<Category, InvoiceRefGroup["items"]>();
  for (const o of orders) {
    const c = o.category as Category;
    const list = refMap.get(c) ?? [];
    for (const it of o.items) {
      list.push({
        name: it.name || it.rawName,
        qty: it.qty || it.rawQty,
        note: it.note || it.rawNote,
      });
    }
    refMap.set(c, list);
  }
  const refGroups: InvoiceRefGroup[] = CATEGORY_ORDER.filter((c) =>
    refMap.has(c),
  ).map((c) => ({ category: c, items: refMap.get(c)! }));

  const categories = allowedCategoriesFor(merchant.role as Role);

  return (
    <>
      <Topbar backHref={`/admin/combined/${userId}/${date}`} title="계산서 작성" />
      <div className="page">
        <h1 className="h1">{merchant.storeName}</h1>
        <p className="lead" style={{ marginTop: 4 }}>
          {labelDate(date)} 출고분 계산서
        </p>

        <InvoiceForm
          userId={userId}
          date={date}
          categories={categories.length ? categories : [...CATEGORY_ORDER]}
          refGroups={refGroups}
        />
      </div>
    </>
  );
}
