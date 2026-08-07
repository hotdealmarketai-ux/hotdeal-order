// 관리자 — 한 점포의 온보딩 단계별 상태 + 본사 확인(이중 확인).
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getOnboardingView } from "@/lib/onboarding";
import {
  AdminConfirmButton,
  CancelOnboardingButton,
} from "@/components/AdminOnboardingControls";

const ACTOR_LABEL: Record<string, string> = {
  MERCHANT: "점주",
  ADMIN: "본사",
  BOTH: "점주·본사",
};

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

  const view = await getOnboardingView(userId);

  return (
    <>
      <Topbar backHref="/admin/onboarding" title={merchant.storeName} />
      <div className="page">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="spread" style={{ alignItems: "baseline" }}>
            <b>진행률</b>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>
              {view.confirmedCount}/{view.total} · {view.percent}%
            </span>
          </div>
          <div className="row__sub" style={{ marginTop: 6 }}>
            {merchant.onboardingCompletedAt
              ? "오픈 완료 — 발주가 열렸습니다."
              : merchant.onboardingStartedAt
                ? "튜토리얼 진행 중 — 발주 잠금."
                : "튜토리얼 미시작(발주 정상)."}
          </div>
        </div>

        <div className="list">
          {view.steps.map((s) => (
            <div key={s.id} className="row" style={{ alignItems: "flex-start" }}>
              <div className="row__main">
                <div className="row__title">
                  {s.order}. {s.title}
                </div>
                <div className="row__sub" style={{ marginTop: 2 }}>
                  담당 {ACTOR_LABEL[s.actor] ?? "점주·본사"} · 점주{" "}
                  {s.merchantDoneAt ? "✓" : "—"} · 본사 {s.adminDoneAt ? "✓" : "—"}
                  {s.confirmed && " · 확정"}
                </div>
              </div>
              <div style={{ flexShrink: 0 }}>
                <AdminConfirmButton
                  userId={userId}
                  stepId={s.id}
                  done={!!s.adminDoneAt}
                />
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <Link href="/admin/onboarding/template" className="btn btn--soft btn--block">
            체크리스트 내용 편집
          </Link>
          {merchant.onboardingStartedAt && !merchant.onboardingCompletedAt && (
            <CancelOnboardingButton userId={userId} />
          )}
        </div>
      </div>
    </>
  );
}
