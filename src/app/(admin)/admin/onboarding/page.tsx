// 관리자 튜토리얼 현황판 — 점포별 진행률(체크박스 기준), 시작/열람.
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
    select: {
      id: true,
      storeName: true,
      onboardingStartedAt: true,
      onboardingCompletedAt: true,
    },
  });

  const inProgress = merchants.filter(
    (m) => m.onboardingStartedAt && !m.onboardingCompletedAt,
  );
  const opened = merchants.filter((m) => m.onboardingCompletedAt);
  const notStarted = merchants.filter((m) => !m.onboardingStartedAt);

  // 진행 중 점포의 진행률(점포별 계산 — 수 적음).
  const progress = new Map<string, { percent: number; c: number; t: number }>();
  await Promise.all(
    inProgress.map(async (m) => {
      const v = await getProgress(m.id);
      progress.set(m.id, { percent: v.percent, c: v.done, t: v.total });
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
            {inProgress.map((m) => {
              const p = progress.get(m.id);
              return (
                <Link
                  key={m.id}
                  href={`/admin/onboarding/${m.id}`}
                  className="row"
                  style={{ textDecoration: "none", alignItems: "center" }}
                >
                  <div className="row__main">
                    <div className="row__title">{m.storeName}</div>
                    <div className="row__sub">
                      {p ? `${p.c}/${p.t} 체크` : ""}
                    </div>
                  </div>
                  <span
                    className="badge badge--wait"
                    style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
                  >
                    {p?.percent ?? 0}%
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        <div className="section-label">기존 지점 ({notStarted.length})</div>
        {notStarted.length === 0 ? (
          <div className="empty">기존 지점이 없어요.</div>
        ) : (
          <div className="list" style={{ marginBottom: 18 }}>
            {notStarted.map((m) => (
              <div key={m.id} className="row" style={{ alignItems: "center" }}>
                <div className="row__main">
                  <div className="row__title">{m.storeName}</div>
                  <div className="row__sub">튜토리얼 완료</div>
                </div>
                <StartOnboardingButton userId={m.id} />
              </div>
            ))}
          </div>
        )}

        {opened.length > 0 && (
          <>
            <div className="section-label">오픈 완료 ({opened.length})</div>
            <div className="list">
              {opened.map((m) => (
                <Link
                  key={m.id}
                  href={`/admin/onboarding/${m.id}`}
                  className="row"
                  style={{ textDecoration: "none", alignItems: "center" }}
                >
                  <div className="row__main">
                    <div className="row__title">{m.storeName}</div>
                  </div>
                  <span className="badge badge--ok" style={{ flexShrink: 0 }}>
                    오픈됨
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
