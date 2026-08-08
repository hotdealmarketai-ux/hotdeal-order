// 관리자 상품 소싱 — 매일 아침 자동 크롤로 추린 후보(보고용). 로컬=매일, 밀키트=주1회.
// 수집·추가는 전부 자동(버튼 없음). 상단에 소싱 날짜, 각 행에 근거(언급 매체 수).
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { LeadStatusButtons, ProductStatusButtons } from "@/components/sourcing/SourcingControls";

export const maxDuration = 60;

const fmt = (n: number) => n.toLocaleString("ko-KR");
const kstStamp = (d: Date | null | undefined) =>
  d
    ? new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

const LEAD_BADGE: Record<string, { label: string; cls: string }> = {
  CONTACTED: { label: "컨택함", cls: "badge--wait" },
  DEAL: { label: "성사", cls: "badge--ok" },
  REJECTED: { label: "거절", cls: "badge--mute" },
};

export default async function AdminSourcingPage(props: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdmin();
  const { tab } = await props.searchParams;
  const active = tab === "mealkit" ? "mealkit" : "local";

  const [leads, products, localRun, mealkitRun] = await Promise.all([
    prisma.sourcingLead.findMany({
      where: { status: { not: "IGNORED" } },
      orderBy: [{ trendScore: "desc" }, { mentions: "desc" }, { lastSeenAt: "desc" }],
      take: 150,
    }),
    prisma.sourcingProduct.findMany({
      where: { status: { not: "IGNORED" } },
      orderBy: [{ demandScore: "desc" }, { mentions: "desc" }, { lastSeenAt: "desc" }],
      take: 150,
    }),
    prisma.sourcingRun.findFirst({
      where: { track: "LOCAL", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    prisma.sourcingRun.findFirst({
      where: { track: "MEALKIT", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  const stamp = active === "mealkit" ? kstStamp(mealkitRun?.finishedAt) : kstStamp(localRun?.finishedAt);

  return (
    <>
      <Topbar backHref="/admin" title="상품 소싱" />
      <div className="page">
        <div className="cattabs cattabs--seg" style={{ marginBottom: 10 }}>
          <a href="/admin/sourcing?tab=local" className={`cattab ${active === "local" ? "is-active" : ""}`}>
            로컬 업체 ({leads.length})
          </a>
          <a href="/admin/sourcing?tab=mealkit" className={`cattab ${active === "mealkit" ? "is-active" : ""}`}>
            밀키트 ({products.length})
          </a>
        </div>

        <div className="srchead">
          <span className="srchead__date">{stamp ? `${stamp} 수집` : "아직 수집 전"}</span>
          <span className="srchead__auto">
            {active === "local" ? "매일 자동" : "매주 월요일 자동"}
          </span>
        </div>

        {active === "local" ? (
          leads.length === 0 ? (
            <div className="empty">아직 수집된 후보가 없어요. (매일 아침 자동 수집)</div>
          ) : (
            <div className="list">
              {leads.map((l) => {
                const b = LEAD_BADGE[l.status];
                return (
                  <div key={l.id} className="srcrow">
                    <div className="srcrow__top">
                      <div className="srcrow__title">
                        {l.name}
                        {b && <span className={`badge ${b.cls}`} style={{ marginLeft: 6 }}>{b.label}</span>}
                      </div>
                      <span className="srcrow__score">{Math.round(l.trendScore)}</span>
                    </div>
                    <div className="srcrow__sub">
                      {[
                        l.region,
                        l.category,
                        l.reviewCount != null ? `리뷰 ${fmt(l.reviewCount)}` : "",
                        l.mentions >= 2 ? `${l.mentions}개 매체` : "단일 매체",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {l.reason && <div className="srcrow__reason">{l.reason}</div>}
                    {(l.phone || l.url || l.instagram) && (
                      <div className="srcrow__links">
                        {l.phone && <span>{l.phone}</span>}
                        {l.url && <a href={l.url} target="_blank" rel="noreferrer noopener">링크</a>}
                        {l.instagram && <a href={l.instagram} target="_blank" rel="noreferrer noopener">인스타</a>}
                      </div>
                    )}
                    <LeadStatusButtons id={l.id} status={l.status} />
                  </div>
                );
              })}
            </div>
          )
        ) : products.length === 0 ? (
          <div className="empty">아직 수집된 후보가 없어요. (매주 월요일 자동 수집)</div>
        ) : (
          <div className="list">
            {products.map((p) => (
              <div key={p.id} className="srcrow">
                <div className="srcrow__top">
                  <div className="srcrow__title">
                    {p.name}
                    {p.status === "PICKED" && <span className="badge badge--ok" style={{ marginLeft: 6 }}>담음</span>}
                  </div>
                  <span className="srcrow__score">{Math.round(p.demandScore)}</span>
                </div>
                <div className="srcrow__sub">
                  {[
                    p.brand,
                    p.price != null ? `${fmt(p.price)}원` : "",
                    p.reviewCount != null ? `리뷰 ${fmt(p.reviewCount)}` : "",
                    p.reviewVelocity > 0 ? `이번 주 +${Math.round(p.reviewVelocity)}` : "",
                    p.mentions >= 2 ? `${p.mentions}개 매체` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {p.reason && <div className="srcrow__reason">{p.reason}</div>}
                {p.url && (
                  <div className="srcrow__links">
                    <a href={p.url} target="_blank" rel="noreferrer noopener">상품 링크</a>
                  </div>
                )}
                <ProductStatusButtons id={p.id} status={p.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
