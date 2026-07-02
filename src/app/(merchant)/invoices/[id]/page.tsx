import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, CATEGORY_ORDER, type Category } from "@/lib/constants";
import { labelDate } from "@/lib/date";
import { formatKDateTime } from "@/lib/format";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 점주 입금요청서(장끼) 상세 — 카테고리별 품목 + 맨 아래 총 결제요청 금액
export default async function MerchantInvoiceDetail(props: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireMerchant();
  const { id } = await props.params;

  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  // 본인 것 + 발행/입금완료만 열람(작성중·취소는 비공개)
  if (!inv || inv.userId !== user.id) notFound();
  if (inv.status !== "ISSUED" && inv.status !== "PAID") notFound();

  const cats = CATEGORY_ORDER.filter((c) =>
    inv.items.some((it) => it.category === c),
  );

  return (
    <>
      <header className="topbar">
        <Link href="/invoices" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">입금요청서</div>
      </header>
      <div className="page">
        {inv.status === "PAID" ? (
          <div className="notice notice--ok" style={{ marginBottom: 14 }}>
            입금이 확인되었습니다. 감사합니다.
            {inv.paidAt ? ` (${formatKDateTime(inv.paidAt)})` : ""}
          </div>
        ) : (
          <div className="notice notice--info" style={{ marginBottom: 14 }}>
            아래 금액을 새롭으로 입금해 주세요. 입금이 확인되면 완료로
            표시돼요.
          </div>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="spread">
            <div>
              <div className="receipt__store">{user.storeName}</div>
              <div className="receipt__meta" style={{ marginTop: 4 }}>
                {labelDate(inv.date)} 출고분 · 새롭 발행
              </div>
            </div>
            {inv.status === "PAID" ? (
              <span className="badge badge--ok">입금 완료</span>
            ) : (
              <span className="badge badge--wait">입금 대기</span>
            )}
          </div>
        </div>

        {cats.map((c) => {
          const items = inv.items.filter((it) => it.category === c);
          const sum = items.reduce((n, it) => n + it.amount, 0);
          return (
            <div className="invcat" key={c}>
              <div className="invcat__head">
                <span className="chip">{CATEGORIES[c].label}</span>
                <span className="invcat__sum">{fmt(sum)}원</span>
              </div>
              {items.map((it) => (
                <div className="invline" key={it.id}>
                  <span>
                    {it.name}
                    <span className="invline__meta">
                      {String(it.qty)} × {fmt(it.unitPrice)}
                    </span>
                  </span>
                  <span className="invline__amt">{fmt(it.amount)}</span>
                </div>
              ))}
            </div>
          );
        })}

        {inv.memo && (
          <div className="card" style={{ marginTop: 4 }}>
            <div className="kv">
              <span className="kv__k">메모</span>
              <span className="kv__v">{inv.memo}</span>
            </div>
          </div>
        )}

        <div className="invgrand">
          <span>총 결제요청 금액</span>
          <b>{fmt(inv.total)}원</b>
        </div>
      </div>
    </>
  );
}
