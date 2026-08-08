import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  allowedCategoriesFor,
  CATEGORIES,
  CATEGORY_ORDER,
  type Category,
  type Role,
} from "@/lib/constants";
import { kstDayRange, labelDate } from "@/lib/date";
import { formatKDateTime } from "@/lib/format";
import { sumQty } from "@/lib/qty";
import { getReservationInvoiceItems } from "@/lib/reservation-data";
import { getWeeklyItemsForStoreShipment } from "@/lib/weekly";
import {
  InvoiceForm,
  type InvoiceInitialItem,
  type InvoiceRefGroup,
  type InvoiceWeeklyItem,
} from "@/components/InvoiceForm";
import { InvoiceAdminActions } from "@/components/InvoiceAdminActions";
import { InvoiceRevisionHistory } from "@/components/InvoiceRevisionHistory";
import { parseRevisionChanges } from "@/lib/invoice-revision";
import { DeleteDraftButton } from "@/components/DeleteDraftButton";
import { RefundReceipt } from "@/components/RefundReceipt";
import { RefundVoidButton } from "@/components/RefundVoidButton";
import { ReviseRefundForm } from "@/components/ReviseRefundForm";
import {
  ReviseInvoiceForm,
  type ReviseInitialItem,
} from "@/components/ReviseInvoiceForm";

const fmt = (n: number) => n.toLocaleString("ko-KR");

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "작성중", cls: "badge--mute" },
  ISSUED: { label: "입금 대기", cls: "badge--wait" },
  PAID: { label: "입금 완료", cls: "badge--ok" },
  VOID: { label: "취소됨", cls: "badge--mute" },
};

export default async function AdminInvoiceDetail(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    issued?: string;
    saved?: string;
    revised?: string;
    refundRevised?: string;
  }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const { issued, saved, revised, refundRevised } = await props.searchParams;

  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      user: true,
    },
  });
  if (!inv) notFound();

  // 환불계산서 — 카테고리·재고·발주 참고 없이 단순 조회 + 제자리 수정(+취소). 일반 계산서 편집 흐름과 분리.
  if (inv.kind === "REFUND") {
    const items = inv.items.map((it) => ({
      name: it.name,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.amount,
    }));
    const refundRevisions = (
      await prisma.invoiceRevision.findMany({
        where: { invoiceId: inv.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          totalBefore: true,
          totalAfter: true,
          changes: true,
        },
      })
    ).map((r) => ({ ...r, changes: parseRevisionChanges(r.changes) }));
    return (
      <>
        <Topbar backHref={`/admin/billing/${inv.userId}`} title="환불계산서" />
        <div className="page">
          {refundRevised === "1" && (
            <div className="notice notice--ok" style={{ marginBottom: 14 }}>
              ✓ 환불계산서를 수정해서 다시 보냈어요. 점주에게 &lsquo;환불계산서가
              수정되었습니다&rsquo; 알림을 보냈어요.
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <span className="badge badge--refund">환불</span>
            {inv.status === "ISSUED" ? (
              <RefundVoidButton id={inv.id} />
            ) : (
              <span className="badge badge--mute">취소됨</span>
            )}
          </div>
          <RefundReceipt
            storeName={inv.user.storeName}
            dateLabel={labelDate(inv.date)}
            items={items}
            note={
              inv.status === "ISSUED"
                ? "이 금액만큼 점포 미수에서 차감되었습니다."
                : "취소된 환불계산서입니다. (미수 복구됨)"
            }
          />
          {inv.revisedAt && (
            <p className="hint center" style={{ marginTop: 8 }}>
              {formatKDateTime(inv.revisedAt)} 수정됨
            </p>
          )}

          <InvoiceRevisionHistory revisions={refundRevisions} isRefund />

          {inv.status === "ISSUED" && (
            <ReviseRefundForm
              invoiceId={inv.id}
              storeName={inv.user.storeName}
              defaultDate={inv.date}
              initialItems={inv.items.map((it) => ({
                name: it.name,
                qty: it.qty,
                unitPrice: it.unitPrice,
              }))}
            />
          )}
        </div>
      </>
    );
  }

  // 작성중이면 편집 화면(발주 참고 포함)
  if (inv.status === "DRAFT") {
    const { start, end } = kstDayRange(inv.date);
    const orders = await prisma.order.findMany({
      where: { userId: inv.userId, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
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

    // 주간발주 합산분(WEEKLY)은 일반 카테고리 rows에서 제외 — 별도 주간발주 섹션에서 편집.
    const initialItems: InvoiceInitialItem[] = inv.items
      .filter((it) => it.category !== "WEEKLY" && it.category !== "DELIVERY")
      .map((it) => ({
        category: it.category as Category,
        name: it.name,
        qty: String(it.qty),
        unitPrice: String(it.unitPrice),
        inventoryItemId: it.inventoryItemId,
      }));
    // 예약분 자동채움 — '공구를 아직 한 번도 확정/저장하지 않은 새 초안'에만 예약 확정분을 공구(TOOL)에 채운다.
    // ⚠ 한 번이라도 공구를 확정하면 그 계산서의 공구 목록(InvoiceItem)이 진실 소스가 된다. 그래야 관리자가 재고부족으로
    //   X 삭제한 예약분을, 예약 레코드가 남아있다는 이유로 매 렌더마다 다시 끌어와 '총 N개'에 되살리지 않는다.
    //   (새 초안에선 그대로 자동 채워 편의 유지 — 확정 안 하고 다시 열어도 예약분이 사라지지 않음.)
    const toolConfirmed = inv.confirmedCats
      .split(",")
      .map((s) => s.trim())
      .includes("TOOL");
    const billedTool = new Set(
      inv.items.filter((it) => it.category === "TOOL").map((it) => it.name.trim()),
    );
    if (billedTool.size === 0 && !toolConfirmed) {
      const reserved = await getReservationInvoiceItems(inv.userId, inv.date);
      for (const r of reserved) {
        initialItems.push({
          category: "TOOL" as Category,
          name: r.name,
          qty: String(r.qty),
          unitPrice: String(r.supplyPrice),
        });
      }
    }
    const allowed = allowedCategoriesFor(inv.user.role as Role);
    const categories = allowed.length ? allowed : [...CATEGORY_ORDER];

    // 주간발주 합산분 — 이미 이 계산서에 불러온 WEEKLY 품목 + 이 출고일에 불러올 확정 주간발주 유무.
    const weeklyItems: InvoiceWeeklyItem[] = inv.items
      .filter((it) => it.category === "WEEKLY")
      .map((it) => ({
        name: it.name,
        qty: String(it.qty),
        unitPrice: String(it.unitPrice),
        unit: it.unit,
      }));
    const weeklyLoadable =
      (
        await getWeeklyItemsForStoreShipment(inv.userId, inv.date, {
          requireConfirmed: false,
        })
      ).length > 0;

    // 공구칸 재고현황 연동 드롭다운용 — 활성 재고 품목(id·이름·점주공급가).
    const invOptions = await prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, supplyPrice: true, qty: true },
      orderBy: { sortOrder: "asc" },
    });
    // 저장된 용달 발송(용차비용) — 있으면 폼이 토글 ON 상태로 복원.
    const deliveryFee =
      inv.items.find((it) => it.category === "DELIVERY")?.unitPrice ?? 0;

    return (
      <>
        <Topbar backHref="/admin/invoices" title="계산서 작성중" />
        <div className="page">
          {saved === "1" && (
            <div className="notice notice--ok" style={{ marginBottom: 14 }}>
              ✓ 임시저장되었어요. 이어서 작성할 수 있어요.
            </div>
          )}
          <h1 className="h1">{inv.user.storeName}</h1>
          <p className="lead" style={{ marginTop: 4 }}>
            {labelDate(inv.date)} 계산서
          </p>
          <InvoiceForm
            invoiceId={inv.id}
            userId={inv.userId}
            date={inv.date}
            categories={categories}
            initialItems={initialItems}
            refGroups={refGroups}
            confirmedCats={inv.confirmedCats}
            weeklyAvailable={weeklyLoadable || weeklyItems.length > 0}
            weeklyItems={weeklyItems}
            invOptions={invOptions}
            deliveryFee={deliveryFee}
          />
          <DeleteDraftButton invoiceId={inv.id} />
        </div>
      </>
    );
  }

  // 발행/입금완료/취소 — 읽기 전용 + 상태 액션
  const badge = STATUS_BADGE[inv.status] ?? STATUS_BADGE.DRAFT;
  // 수정 내역(재발송 시점별) — 최신순. 점주 화면과 동일 컴포넌트.
  const revisions = (
    await prisma.invoiceRevision.findMany({
      where: { invoiceId: inv.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        totalBefore: true,
        totalAfter: true,
        changes: true,
      },
    })
  ).map((r) => ({ ...r, changes: parseRevisionChanges(r.changes) }));
  const cats = CATEGORY_ORDER.filter((c) =>
    inv.items.some((it) => it.category === c),
  );

  // 입금대기(ISSUED)·일반발주(DAILY)면 제자리 수정 폼을 붙인다(같은 계산서 갱신·재발송).
  const canRevise = inv.status === "ISSUED" && inv.kind === "DAILY";
  const reviseItems: ReviseInitialItem[] = inv.items
    .filter((it) => it.category !== "WEEKLY" && it.category !== "DELIVERY")
    .map((it) => ({
      category: it.category as Category,
      name: it.name,
      qty: String(it.qty),
      unitPrice: String(it.unitPrice),
      inventoryItemId: it.inventoryItemId,
    }));
  // 공구칸 재고현황 연동 드롭다운용 — 수정 폼도 계산서 발행처럼 재고 검색·연동 가능하게.
  const reviseInvOptions = canRevise
    ? await prisma.inventoryItem.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, supplyPrice: true, qty: true },
        orderBy: { sortOrder: "asc" },
      })
    : [];
  // 주간발주 합산분(읽기 전용 표시) — 발행된 계산서 영수증에 별도 섹션으로.
  const weeklyBilled = inv.items.filter((it) => it.category === "WEEKLY");
  const deliveryBilled = inv.items.filter((it) => it.category === "DELIVERY");
  const reviseAllowed = allowedCategoriesFor(inv.user.role as Role);
  const reviseCategories = reviseAllowed.length
    ? reviseAllowed
    : [...CATEGORY_ORDER];

  return (
    <>
      <Topbar backHref="/admin/invoices" title="계산서" />
      <div className="page">
        {issued === "1" && (
          <div className="notice notice--ok" style={{ marginBottom: 14 }}>
            ✓ 계산서가 발행되었어요. 점주에게 입금요청 알림을 보냈어요.
          </div>
        )}
        {revised === "1" && (
          <div className="notice notice--ok" style={{ marginBottom: 14 }}>
            ✓ 계산서를 수정해서 다시 보냈어요. 점주에게 &lsquo;계산서가
            수정되었습니다&rsquo; 알림을 보냈어요.
          </div>
        )}
        {inv.status === "VOID" && (
          <div className="notice notice--mute" style={{ marginBottom: 14 }}>
            취소된 계산서예요. 다시 보내려면{" "}
            <Link
              href={`/admin/combined/${inv.userId}/${inv.date}`}
              style={{ textDecoration: "underline" }}
            >
              합본 발주서
            </Link>
            에서 새로 작성하세요.
          </div>
        )}
        {inv.status === "PAID" && inv.paidAt && (
          <div className="notice notice--ok" style={{ marginBottom: 14 }}>
            {formatKDateTime(inv.paidAt)} 입금 확인됨
          </div>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="spread">
            <div>
              <div className="receipt__store">{inv.user.storeName}</div>
              <div className="receipt__meta" style={{ marginTop: 4 }}>
                {labelDate(inv.date)} 출고분
                {inv.issuedAt ? ` · ${formatKDateTime(inv.issuedAt)} 발행` : ""}
                {inv.revisedAt ? ` · ${formatKDateTime(inv.revisedAt)} 수정` : ""}
              </div>
            </div>
            <span className={`badge ${badge.cls}`}>{badge.label}</span>
          </div>
        </div>

        {deliveryBilled.length > 0 && (
          <div className="invcat">
            <div className="invcat__head">
              <span className="chip">용달 발송</span>
              <span className="invcat__sum">
                {fmt(deliveryBilled.reduce((n, it) => n + it.amount, 0))}원
              </span>
            </div>
            {deliveryBilled.map((it) => (
              <div className="invline" key={it.id}>
                <span>용차비용</span>
                <span className="invline__amt">{fmt(it.amount)}원</span>
              </div>
            ))}
          </div>
        )}

        {cats.map((c) => {
          const items = inv.items.filter((it) => it.category === c);
          const sum = items.reduce((n, it) => n + it.amount, 0);
          return (
            <div className="invcat" key={c}>
              <div className="invcat__head">
                <span className="chip">{CATEGORIES[c].label}</span>
                <span className="invcat__sum">
                  총 {fmt(sumQty(items.map((it) => String(it.qty))))}개 · {fmt(sum)}원
                </span>
              </div>
              {items.map((it, i) => (
                <div className="invline" key={it.id}>
                  <span>
                    <span className="receipt-item__no">{i + 1}</span>
                    {it.name}
                    <span className="invline__meta">
                      {String(it.qty)} × {fmt(it.unitPrice)}
                    </span>
                  </span>
                  <span className="invline__amt">{fmt(it.amount)}원</span>
                </div>
              ))}
            </div>
          );
        })}

        {weeklyBilled.length > 0 && (
          <div className="invcat">
            <div className="invcat__head">
              <span className="chip">주간발주</span>
              <span className="invcat__sum">
                {fmt(weeklyBilled.reduce((n, it) => n + it.amount, 0))}원
              </span>
            </div>
            {weeklyBilled.map((it, i) => (
              <div className="invline" key={it.id}>
                <span>
                  <span className="receipt-item__no">{i + 1}</span>
                  {it.name}
                  <span className="invline__meta">
                    {String(it.qty)}
                    {it.unit} × {fmt(it.unitPrice)}
                  </span>
                </span>
                <span className="invline__amt">{fmt(it.amount)}원</span>
              </div>
            ))}
          </div>
        )}

        <div className="invgrand">
          <span>총 결제요청 금액</span>
          <b>{fmt(inv.total)}원</b>
        </div>

        <InvoiceAdminActions invoiceId={inv.id} status={inv.status} />

        <InvoiceRevisionHistory revisions={revisions} />

        {canRevise && (
          <ReviseInvoiceForm
            invoiceId={inv.id}
            date={inv.date}
            categories={reviseCategories}
            initialItems={reviseItems}
            invOptions={reviseInvOptions}
          />
        )}
      </div>
    </>
  );
}
