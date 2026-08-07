// 관리자 상품 소싱 — 매일 아침 크롤로 추린 후보. 탭: 로컬 업체(컨택) / 밀키트(수요).
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  RunButton,
  LeadStatusButtons,
  ProductStatusButtons,
  ManualLeadForm,
  ManualProductForm,
} from "@/components/sourcing/SourcingControls";

const fmt = (n: number) => n.toLocaleString("ko-KR");

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

  const [leads, products] = await Promise.all([
    prisma.sourcingLead.findMany({
      where: { status: { not: "IGNORED" } },
      orderBy: [{ trendScore: "desc" }, { lastSeenAt: "desc" }],
      take: 120,
    }),
    prisma.sourcingProduct.findMany({
      where: { status: { not: "IGNORED" } },
      orderBy: [{ demandScore: "desc" }, { lastSeenAt: "desc" }],
      take: 120,
    }),
  ]);

  return (
    <>
      <Topbar backHref="/admin" title="상품 소싱" />
      <div className="page">
        <div className="cattabs cattabs--seg" style={{ marginBottom: 12 }}>
          <Link href="/admin/sourcing?tab=local" className={`cattab ${active === "local" ? "is-active" : ""}`}>
            로컬 업체 ({leads.length})
          </Link>
          <Link href="/admin/sourcing?tab=mealkit" className={`cattab ${active === "mealkit" ? "is-active" : ""}`}>
            밀키트 ({products.length})
          </Link>
        </div>

        <div className="spread" style={{ alignItems: "center", marginBottom: 12 }}>
          <RunButton track={active === "mealkit" ? "mealkit" : "local"} />
          {active === "local" ? <ManualLeadForm /> : <ManualProductForm />}
        </div>

        {active === "local" ? (
          leads.length === 0 ? (
            <div className="empty">아직 후보가 없어요. ‘지금 수집’ 또는 ‘직접 추가’.</div>
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
                      {[l.region, l.category, l.reviewCount != null ? `리뷰 ${fmt(l.reviewCount)}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {l.reason && <div className="srcrow__reason">{l.reason}</div>}
                    {(l.phone || l.url || l.instagram) && (
                      <div className="srcrow__links">
                        {l.phone && <span>{l.phone}</span>}
                        {l.url && (
                          <a href={l.url} target="_blank" rel="noreferrer noopener">
                            링크
                          </a>
                        )}
                        {l.instagram && (
                          <a href={l.instagram} target="_blank" rel="noreferrer noopener">
                            인스타
                          </a>
                        )}
                      </div>
                    )}
                    <LeadStatusButtons id={l.id} status={l.status} />
                  </div>
                );
              })}
            </div>
          )
        ) : products.length === 0 ? (
          <div className="empty">아직 후보가 없어요. ‘지금 수집’ 또는 ‘직접 추가’.</div>
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
                    p.reviewVelocity > 0 ? `+${p.reviewVelocity.toFixed(1)}/일` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {p.reason && <div className="srcrow__reason">{p.reason}</div>}
                {p.url && (
                  <div className="srcrow__links">
                    <a href={p.url} target="_blank" rel="noreferrer noopener">
                      상품 링크
                    </a>
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
