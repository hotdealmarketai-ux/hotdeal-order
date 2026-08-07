// 점주 '오픈 준비' — 진행률(체크박스 기준) + 대분류 목록. 100%면 발주가 열린다.
import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { LogoutButton } from "@/components/LogoutButton";
import { requireMerchant } from "@/lib/session";
import {
  needsOnboarding,
  getProgress,
  getRootNodes,
  maybeCompleteOnboarding,
} from "@/lib/onboarding";

export default async function OnboardingPage() {
  const user = await requireMerchant();
  if (!needsOnboarding(user)) redirect("/order");
  // 자가 치유 — 체크 토글 외 경로로 이미 완료 상태면(빈 템플릿/미체크 블록 삭제/취소→재시작) 여기서 완료 처리 후 발주로.
  if (await maybeCompleteOnboarding(user.id)) redirect("/order");

  const [progress, roots] = await Promise.all([
    getProgress(user.id),
    getRootNodes(),
  ]);

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
              <b>{progress.percent}%</b> · {progress.done}/{progress.total}
            </span>
          </div>
          <div className="onbprog__bar">
            <div className="onbprog__fill" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>

        {roots.length === 0 ? (
          <div className="empty">준비 항목이 곧 등록돼요.</div>
        ) : (
          <>
            <div className="section-label">준비 항목</div>
            <div className="list">
              {roots.map((n) => (
                <Link
                  key={n.id}
                  href={`/onboarding/${n.id}`}
                  className="row"
                  style={{ textDecoration: "none", alignItems: "center" }}
                >
                  <div className="row__main">
                    <div className="row__title">{n.title || "(제목 없음)"}</div>
                  </div>
                  <span className="onbstep__chev" aria-hidden>
                    ›
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <LogoutButton className="btn btn--ghost btn--sm" label="로그아웃" />
        </div>
      </div>
    </>
  );
}
