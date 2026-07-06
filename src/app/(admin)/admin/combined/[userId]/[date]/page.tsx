import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, CATEGORY_ORDER, type Category } from "@/lib/constants";
import { kstDayRange, labelDate, normalizeDateStr } from "@/lib/date";
import { PrintButton } from "@/components/PrintButton";

export default async function AdminCombinedReceipt(props: {
  params: Promise<{ userId: string; date: string }>;
}) {
  await requireAdmin();
  const { userId, date: rawDate } = await props.params;
  const date = normalizeDateStr(rawDate);
  const { start, end } = kstDayRange(date);

  const merchant = await prisma.user.findUnique({ where: { id: userId } });
  if (!merchant) notFound();

  const orders = await prisma.order.findMany({
    where: { userId, createdAt: { gte: start, lt: end } },
    include: { items: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  if (orders.length === 0) notFound();

  // 같은 종류(과일/야채/공구/두부)는 한 섹션으로 병합 — 4종이 합쳐진 하나의 발주서
  type Item = { name: string; qty: string; note: string };
  const byCat = new Map<Category, Item[]>();
  for (const o of orders) {
    const c = o.category as Category;
    const list = byCat.get(c) ?? [];
    for (const it of o.items) list.push({ name: it.name, qty: it.qty, note: it.note });
    byCat.set(c, list);
  }
  const sections = CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
    cat: c,
    items: byCat.get(c)!,
  }));
  const totalItems = sections.reduce((n, s) => n + s.items.length, 0);

  // 이 점포·날짜의 계산서(취소 제외) — 있으면 보기, 없으면 작성 버튼
  const invoice = await prisma.invoice.findFirst({
    where: { userId, date, status: { not: "VOID" } },
    select: { id: true, status: true, total: true },
  });
  const invoiceLabel =
    invoice?.status === "DRAFT"
      ? "계산서 이어서 작성 (작성중)"
      : invoice?.status === "PAID"
        ? "계산서 보기 · 입금 완료"
        : invoice
          ? "계산서 보기 · 발행됨"
          : "계산서 작성";

  return (
    <>
      <Topbar backHref="/admin/hotdeal" title="발주서" />
      <div className="page">
        <div style={{ marginBottom: 16 }}>
          <Link
            href={
              invoice
                ? `/admin/invoices/${invoice.id}`
                : `/admin/invoices/new?user=${userId}&date=${date}`
            }
            className="btn btn--primary"
          >
            {invoiceLabel}
          </Link>
        </div>

        <div className="receipt" id="receipt-print">
          <div className="receipt__head">
            <div className="receipt__store">{merchant.storeName}</div>
            <div
              className="receipt__meta"
              style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}
            >
              <span className="badge badge--mute">{labelDate(date)}</span>
              <span className="badge badge--mute">
                {sections.length}종 · {totalItems}건
              </span>
            </div>
          </div>

          {sections.map((s) => {
            const cat = CATEGORIES[s.cat];
            return (
              <div className="receipt__section" key={s.cat}>
                <div className="section-label" style={{ margin: "0 0 8px" }}>
                  {cat.label}
                </div>
                {s.items.map((it, i) => (
                  <div className="receipt-item" key={i}>
                    <div className="receipt-item__name">{it.name || "-"}</div>
                    <div className="receipt-item__qty">{it.qty}</div>
                    {it.note && (
                      <div className="receipt-item__note">※ {it.note}</div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14 }}>
          <PrintButton />
        </div>
      </div>
    </>
  );
}
