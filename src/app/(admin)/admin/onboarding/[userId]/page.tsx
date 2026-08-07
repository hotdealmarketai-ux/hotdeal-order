// 관리자 — 한 점포의 튜토리얼 승인. 최하위 항목(경로 표시)별 승인/해제 + 진행률 + 취소.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getProgress, getLeafApprovals } from "@/lib/onboarding";
import { AdminApproveButton } from "@/components/onboarding/AdminApproveButton";
import { CancelOnboardingButton } from "@/components/AdminOnboardingControls";

export default async function AdminOnboardingMerchantPage(props: {
  params: Promise<{ userId: string }>;
}) {
  await requireAdmin();
  const { userId } = await props.params;

  const merchant = await prisma.user.findUnique({
    where: { id: userId },
    select: { storeName: true, role: true, onboardingStartedAt: true, onboardingCompletedAt: true },
  });
  if (!merchant || merchant.role !== "MERCHANT_HOTDEAL") notFound();

  const [progress, leaves] = await Promise.all([getProgress(userId), getLeafApprovals(userId)]);
  const waiting = leaves.filter((l) => l.requestedAt && !l.approvedAt).length;

  return (
    <>
      <Topbar backHref="/admin/onboarding" title={merchant.storeName} />
      <div className="page">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="spread" style={{ alignItems: "baseline" }}>
            <b>진행률</b>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>
              {progress.percent}%
            </span>
          </div>
          <div className="row__sub" style={{ marginTop: 6 }}>
            {merchant.onboardingCompletedAt
              ? "오픈 완료 — 발주가 열렸습니다."
              : merchant.onboardingStartedAt
                ? `튜토리얼 진행 중 — 발주 잠금${waiting > 0 ? ` · 승인 대기 ${waiting}건` : ""}.`
                : "기존 지점 — 발주 정상."}
          </div>
        </div>

        {leaves.length === 0 ? (
          <div className="empty">
            체크 항목이 없어요.{" "}
            <Link href="/admin/onboarding/template">튜토리얼 편집</Link>에서 추가하세요.
          </div>
        ) : (
          <div className="list">
            {leaves.map((l) => {
              const waitingItem = l.requestedAt && !l.approvedAt;
              return (
                <div key={l.id} className="row" style={{ alignItems: "center", gap: 10 }}>
                  <div className="row__main">
                    {l.path && <div className="row__sub">{l.path}</div>}
                    <div className="row__title">
                      {l.title || "(제목 없음)"}
                      {l.approvedAt ? (
                        <span className="badge badge--ok" style={{ marginLeft: 6 }}>승인됨</span>
                      ) : waitingItem ? (
                        <span className="badge badge--wait" style={{ marginLeft: 6 }}>승인 대기</span>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <AdminApproveButton userId={userId} nodeId={l.id} approved={!!l.approvedAt} />
                  </div>
                </div>
              );
            })}
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
