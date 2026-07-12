import { Topbar } from "@/components/Topbar";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, CATEGORY_ORDER, type Category } from "@/lib/constants";
import { kstDayRange, labelDate, normalizeDateStr } from "@/lib/date";
import { PrintButton } from "@/components/PrintButton";
import { CancelStoreOrdersButton } from "@/components/CancelStoreOrdersButton";

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

  // 취소는 하드삭제라 정상 흐름엔 CANCELLED가 없지만, 잔존 행 방어적 제외.
  const active = orders.filter((o) => o.status !== "CANCELLED");
  // 발주취소로 전량 삭제되면 이 발주서는 사라짐 → 목록으로 되돌린다.
  if (active.length === 0) redirect("/admin/hotdeal");

  // 같은 종류(과일/야채/공구/두부)는 한 섹션으로 병합 — 4종이 합쳐진 하나의 발주서
  type Item = { name: string; qty: string; note: string };
  const byCat = new Map<Category, Item[]>();
  for (const o of active) {
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

  return (
    <>
      <Topbar backHref="/admin/hotdeal" title="발주서" />
      <div className="page">
        {/* #3 발주취소를 발주서 안 상단으로(계산서 발행은 목록으로 이동). 검토 후 이 발주서 단위로 취소. */}
        <div
          style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}
        >
          <CancelStoreOrdersButton
            userId={userId}
            date={date}
            store={merchant.storeName}
          />
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
