// 관리자 튜토리얼 현황판 — 진행 중 / 기존 지점(=완료·미시작, 다시 시작 가능).
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getProgress } from "@/lib/onboarding";
import { StartOnboardingButton } from "@/components/AdminOnboardingControls";

export default async function AdminOnboardingPage() {
  await requireAdmin();

  const merchants = await prisma.user.findMany({
    where: { role: "MERCHANT_HOTDEAL", status: "APPROVED" },
    orderBy: { storeName: "asc" },
    select: { id: true, storeName: true, onboardingStartedAt: true, onboardingCompletedAt: true },
  });

  const inProgress = merchants.filter((m) => m.onboardingStartedAt && !m.onboardingCompletedAt);
  // 기존 지점 = 진행 중이 아닌 모든 점포(미시작 + 완료). 다시 시작 가능.
  const rest = merchants.filter((m) => !(m.onboardingStartedAt && !m.onboardingCompletedAt));

  const progress = new Map<string, number>();
  await Promise.all(
    inProgress.map(async (m) => {
      const v = await getProgress(m.id);
      progress.set(m.id, v.percent);
    }),
  );

  return (
    <>
      <Topbar
        backHref="/admin"
        title="튜토리얼"
        right={
          <Link href="/admin/onboarding/template" className="btn btn--xs btn--soft">
            편집
          </Link>
        }
      />
      <div className="page">
        <div className="section-label">튜토리얼 진행 중 ({inProgress.length})</div>
        {inProgress.length === 0 ? (
          <div className="empty">진행 중인 점포가 없어요.</div>
        ) : (
          <div className="list" style={{ marginBottom: 18 }}>
            {inProgress.map((m) => (
              <Link
                key={m.id}
                href={`/admin/onboarding/${m.id}`}
                className="row"
                style={{ textDecoration: "none", alignItems: "center" }}
              >
                <div className="row__main">
                  <div className="row__title">{m.storeName}</div>
                </div>
                <span
                  className="badge badge--wait"
                  style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
                >
                  {progress.get(m.id) ?? 0}%
                </span>
              </Link>
            ))}
          </div>
        )}

        <div className="section-label">기존 지점 ({rest.length})</div>
        {rest.length === 0 ? (
          <div className="empty">기존 지점이 없어요.</div>
        ) : (
          <div className="list">
            {rest.map((m) => (
              <div key={m.id} className="row" style={{ alignItems: "center" }}>
                <div className="row__main">
                  <div className="row__title">{m.storeName}</div>
                  <div className="row__sub">
                    {m.onboardingCompletedAt ? "튜토리얼 완료" : "기존 지점 — 발주 정상"}
                  </div>
                </div>
                <StartOnboardingButton userId={m.id} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
