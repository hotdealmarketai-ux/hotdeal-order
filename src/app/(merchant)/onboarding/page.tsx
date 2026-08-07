// 점주 '오픈 준비' — 분류 트리 = 체크리스트(롤업). 하위가 모두 승인되면 상위가 완료.
// 100%면 발주 오픈. 100%에 도달했는데 completedAt 미세팅이면 렌더 시 자가 완료.
import { redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { LogoutButton } from "@/components/LogoutButton";
import { requireMerchant } from "@/lib/session";
import { needsOnboarding, maybeCompleteOnboarding, getTreeWithState } from "@/lib/onboarding";
import { OnbTreeView } from "@/components/onboarding/OnbTreeView";

export default async function OnboardingPage() {
  const user = await requireMerchant();
  if (!needsOnboarding(user)) redirect("/order");
  // 자가 치유 — 체크 외 경로로 이미 완료면(빈 템플릿/분류 삭제 등) 여기서 완료 후 발주로.
  if (await maybeCompleteOnboarding(user.id)) redirect("/order");

  const { roots, state, progress } = await getTreeWithState(user.id);

  return (
    <>
      <Topbar brand="핫딜마켓" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <div className="onbhead">
          <h1 className="h1">오픈 준비</h1>
        </div>

        <div className="onbprog">
          <div className="onbprog__top">
            <span className="onbprog__label">준비 진행률</span>
            <span className="onbprog__pct">
              <b>{progress.percent}%</b>
            </span>
          </div>
          <div className="onbprog__bar">
            <div className="onbprog__fill" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>

        {roots.length === 0 ? (
          <div className="empty">준비 항목이 곧 등록돼요.</div>
        ) : (
          <div className="onbtree">
            <OnbTreeView nodes={roots} state={state} />
          </div>
        )}

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <LogoutButton className="btn btn--ghost btn--sm" label="로그아웃" />
        </div>
      </div>
    </>
  );
}
