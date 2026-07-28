import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  CATEGORIES,
  CATEGORY_ORDER,
  fulfillmentLabel,
  type Category,
} from "@/lib/constants";
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
  // #9 발주취소로 전량 삭제되면(orders 0) 또는 잔존 CANCELLED만 남으면 → 404 대신 발주 목록으로.
  const active = orders.filter((o) => o.status !== "CANCELLED");
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
  // 수령 방식(직접 픽업/배송) — 발주 1건 전체에 동일, 배송이면 매장 주소로 갖다줘야 함.
  const fulfillment = active.find((o) => o.fulfillment)?.fulfillment ?? null;

  // 관리자 발주 수정 — 계산서 발행분(user+date DAILY ISSUED/PAID)은 잠금(정합)
  const issuedInv = await prisma.invoice.findFirst({
    where: {
      userId,
      kind: "DAILY",
      date,
      status: { in: ["ISSUED", "PAID"] },
    },
    select: { id: true },
  });
  const editLocked = !!issuedInv;
  // 카테고리별로 수정 진입점 — 활성 발주 1건씩(보통 종류당 1건)
  const editable = active.map((o) => ({
    id: o.id,
    label: CATEGORIES[o.category as Category].label,
    count: o.items.length,
  }));

  return (
    <>
      <Topbar backHref="/admin/hotdeal" title="발주서" />
      <div className="page">
        {/* #3 발주서 안 상단 발주취소(계산서는 목록으로) · #8 크게·전체폭 */}
        <div style={{ marginBottom: 16 }}>
          <CancelStoreOrdersButton
            userId={userId}
            date={date}
            store={merchant.storeName}
            big
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
              {fulfillmentLabel(fulfillment) && (
                <span
                  className={`badge ${
                    fulfillment === "DELIVERY" ? "badge--deliver" : "badge--pickup"
                  }`}
                >
                  {fulfillmentLabel(fulfillment)}
                </span>
              )}
              <span className="badge badge--mute">
                {sections.length}종 · {totalItems}건
              </span>
            </div>
            {fulfillment === "DELIVERY" && merchant.address && (
              <div className="receipt__deliver">
                <span className="receipt__deliverk">배송지</span>
                <span>{merchant.address}</span>
              </div>
            )}
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

        {/* 관리자 발주 수정 — 프린트 영역 밖. 종류별로 해당 발주를 고칠 수 있어요. */}
        <div className="card card--flat" style={{ marginTop: 18 }}>
          <div className="section-label" style={{ marginBottom: 10 }}>
            발주 수정
          </div>
          {editLocked ? (
            <div className="muted" style={{ fontSize: 13 }}>
              입금요청서가 발행된 발주라 수정이 잠겨 있어요. 계산서를 수정해 주세요.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {editable.map((e) => (
                <div className="spread" key={e.id}>
                  <span style={{ fontSize: 14 }}>
                    <b>{e.label}</b>
                    <span className="muted" style={{ marginLeft: 6 }}>
                      {e.count}건
                    </span>
                  </span>
                  <Link
                    href={`/admin/orders/${e.id}/edit`}
                    className="btn btn--xs btn--soft"
                  >
                    수정
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
