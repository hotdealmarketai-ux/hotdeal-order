import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
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
import { getReservationInvoiceItems } from "@/lib/reservation-data";
import {
  InvoiceForm,
  type InvoiceRefGroup,
  type InvoiceInitialItem,
} from "@/components/InvoiceForm";

// 계산서 새로 작성 — 합본 발주서의 '계산서 작성' 버튼에서 진입
export default async function NewInvoicePage(props: {
  searchParams: Promise<{ user?: string; date?: string }>;
}) {
  await requireAdmin();
  const { user: userId = "", date: rawDate } = await props.searchParams;
  const date = normalizeDateStr(rawDate);

  const merchant = await prisma.user.findUnique({ where: { id: userId } });
  if (!merchant || !isMerchant(merchant.role as Role)) notFound();

  // 같은 날짜에 계산서를 여러 장 발행할 수 있음(부분·추가 청구).
  // 예약분 자동채움을 '첫 계산서'로만 제한하면, 그날 다른 계산서를 먼저 발행한 경우 예약분이
  // 영영 미청구로 남는다 → 기존 계산서(취소 제외)에 이미 들어간 공구(TOOL) 품목명을 모아
  // '아직 청구 안 된 예약분'만 자동채움한다(중복청구도, 누락도 방지).
  const existingInvoices = await prisma.invoice.findMany({
    where: { userId, date, status: { not: "VOID" } },
    select: { items: { where: { category: "TOOL" }, select: { name: true } } },
  });
  const billedToolNames = new Set<string>();
  for (const inv of existingInvoices)
    for (const it of inv.items) billedToolNames.add(it.name.trim());

  // 그날 발주 내역 — 참고용(출고 기준으로 직접 입력하므로 자동 채움 안 함)
  const { start, end } = kstDayRange(date);
  const orders = await prisma.order.findMany({
    where: { userId, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
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

  // 예약분 자동 채움 — 확정 예약분 중 '아직 어느 계산서에도 안 들어간' 품목만 공구(TOOL)에 채움.
  const reserved = await getReservationInvoiceItems(userId, date);
  const initialItems: InvoiceInitialItem[] = reserved
    .filter((r) => !billedToolNames.has(r.name.trim()))
    .map((r) => ({
      category: "TOOL" as Category,
      name: r.name,
      qty: String(r.qty),
      unitPrice: String(r.supplyPrice),
    }));

  return (
    <>
      <Topbar backHref={`/admin/combined/${userId}/${date}`} title="계산서 작성" />
      <div className="page">
        <h1 className="h1">{merchant.storeName}</h1>
        <p className="lead" style={{ marginTop: 4 }}>
          {labelDate(date)} 출고분 계산서
        </p>
        {initialItems.length > 0 && (
          <div className="notice notice--ai" style={{ marginBottom: 14 }}>
            공구에 <b>예약분 {initialItems.length}건</b>을 자동으로 채웠어요. (확인 후 발행)
          </div>
        )}

        <InvoiceForm
          userId={userId}
          date={date}
          categories={categories.length ? categories : [...CATEGORY_ORDER]}
          initialItems={initialItems}
          refGroups={refGroups}
        />
      </div>
    </>
  );
}
