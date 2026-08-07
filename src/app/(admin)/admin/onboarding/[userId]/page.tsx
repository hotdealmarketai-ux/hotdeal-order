// 관리자 — 한 점포의 튜토리얼 진행. 진행률 + 전체 체크박스(분류 경로 표시) 대리 체크 + 취소.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getProgress, getAllCheckBlocks, getUserChecks } from "@/lib/onboarding";
import { OnbCheckbox } from "@/components/onboarding/OnbCheckbox";
import { CancelOnboardingButton } from "@/components/AdminOnboardingControls";

export default async function AdminOnboardingMerchantPage(props: {
  params: Promise<{ userId: string }>;
}) {
  await requireAdmin();
  const { userId } = await props.params;

  const merchant = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      storeName: true,
      role: true,
      onboardingStartedAt: true,
      onboardingCompletedAt: true,
    },
  });
  if (!merchant || merchant.role !== "MERCHANT_HOTDEAL") notFound();

  const [progress, checks] = await Promise.all([
    getProgress(userId),
    getAllCheckBlocks(),
  ]);
  const checked = await getUserChecks(
    userId,
    checks.map((c) => c.id),
  );

  return (
    <>
      <Topbar backHref="/admin/onboarding" title={merchant.storeName} />
      <div className="page">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="spread" style={{ alignItems: "baseline" }}>
            <b>진행률</b>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>
              {progress.done}/{progress.total} · {progress.percent}%
            </span>
          </div>
          <div className="row__sub" style={{ marginTop: 6 }}>
            {merchant.onboardingCompletedAt
              ? "오픈 완료 — 발주가 열렸습니다."
              : merchant.onboardingStartedAt
                ? "튜토리얼 진행 중 — 발주 잠금."
                : "기존 지점 — 발주 정상."}
          </div>
        </div>

        {checks.length === 0 ? (
          <div className="empty">
            체크 항목이 없어요.{" "}
            <Link href="/admin/onboarding/template">튜토리얼 편집</Link>에서 추가하세요.
          </div>
        ) : (
          <div className="list">
            {checks.map((c) => (
              <div key={c.id} className="row" style={{ alignItems: "center", gap: 10 }}>
                <div className="row__main">
                  {c.path && <div className="row__sub">{c.path}</div>}
                  <div className="row__title">{c.text || "(제목 없음)"}</div>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <OnbCheckbox
                    blockId={c.id}
                    label=""
                    checked={checked.has(c.id)}
                    userId={userId}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <Link href="/admin/onboarding/template" className="btn btn--soft btn--block">
            튜토리얼 편집
          </Link>
          {merchant.onboardingStartedAt && !merchant.onboardingCompletedAt && (
            <CancelOnboardingButton userId={userId} />
          )}
        </div>
      </div>
    </>
  );
}
