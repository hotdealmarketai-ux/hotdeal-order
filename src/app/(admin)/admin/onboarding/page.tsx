// 관리자 가맹 온보딩 현황판 — 점포별 진행률, 시작/열람. 점포 클릭 시 단계별 확인.
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getOnboardingView } from "@/lib/onboarding";
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
      const v = await getOnboardingView(m.id);
      progress.set(m.id, { percent: v.percent, c: v.confirmedCount, t: v.total });
    }),
  );

  return (
    <>
      <Topbar backHref="/admin" title="오픈 튜토리얼" />
      <div className="page">
        <div className="notice notice--mute" style={{ marginBottom: 16 }}>
          오픈 전 준비 체크리스트. 점주 완료 + 본사 확인이 모두 되면 그 단계가 확정되고,
          전 단계 확정 시 그 점포의 발주가 열립니다.
          <br />
          체크리스트 내용(제목·설명·이미지) 편집은{" "}
          <Link href="/admin/onboarding/template">체크리스트 편집</Link>에서.
        </div>

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
                      {p ? `${p.c}/${p.t} 단계 확정` : ""}
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

        <div className="section-label">튜토리얼 미시작 ({notStarted.length})</div>
        {notStarted.length === 0 ? (
          <div className="empty">모든 승인 점포가 튜토리얼을 시작했어요.</div>
        ) : (
          <div className="list" style={{ marginBottom: 18 }}>
            {notStarted.map((m) => (
              <div key={m.id} className="row" style={{ alignItems: "center" }}>
                <div className="row__main">
                  <div className="row__title">{m.storeName}</div>
                  <div className="row__sub">발주 정상(튜토리얼 대상 아님)</div>
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
