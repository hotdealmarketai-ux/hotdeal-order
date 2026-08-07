// 점주 '오픈 준비' 퀘스트 — 딥그린 진행바 + 타임라인(제목 쭉). 100%면 발주가 열린다.
import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { LogoutButton } from "@/components/LogoutButton";
import { requireMerchant } from "@/lib/session";
import { needsOnboarding, getOnboardingView } from "@/lib/onboarding";

export default async function OnboardingPage() {
  const user = await requireMerchant();
  // 온보딩 대상이 아니면(시작 안 함 or 이미 완료) 발주 화면으로.
  if (!needsOnboarding(user)) redirect("/order");

  const view = await getOnboardingView(user.id);

  const statusOf = (s: (typeof view.steps)[number]) =>
    s.confirmed
      ? { label: "완료", cls: "badge--ok" }
      : s.merchantDoneAt
        ? { label: "본사 확인 대기", cls: "badge--wait" }
        : s.adminDoneAt
          ? { label: "완료 체크 필요", cls: "badge--wait" }
          : { label: "대기", cls: "badge--mute" };

  return (
    <>
      <Topbar brand="핫딜마켓" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <div className="onbhead">
          <h1 className="h1">오픈 준비</h1>
          <p className="onbhead__sub">
            아래 준비가 모두 끝나면 발주가 열려요. 완료한 항목을 눌러 체크해 주세요.
          </p>
        </div>

        <div className="onbprog">
          <div className="onbprog__top">
            <span className="onbprog__label">준비 진행률</span>
            <span className="onbprog__pct">
              <b>{view.percent}%</b> · {view.confirmedCount}/{view.total}
            </span>
          </div>
          <div className="onbprog__bar">
            <div className="onbprog__fill" style={{ width: `${view.percent}%` }} />
          </div>
        </div>

        <div className="section-label">준비 단계</div>
        <div className="onbtl">
          {view.steps.map((s) => {
            const st = statusOf(s);
            return (
              <Link key={s.id} href={`/onboarding/${s.id}`} className="onbstep">
                <span
                  className={`onbstep__node ${s.confirmed ? "is-done" : ""}`}
                  aria-hidden
                >
                  {s.confirmed ? "✓" : s.order}
                </span>
                <span className="onbstep__card">
                  <span className="onbstep__title">{s.title}</span>
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                  <span className="onbstep__chev" aria-hidden>
                    ›
                  </span>
                </span>
              </Link>
            );
          })}
        </div>

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <LogoutButton className="btn btn--ghost btn--sm" label="로그아웃" />
        </div>
      </div>
    </>
  );
}
