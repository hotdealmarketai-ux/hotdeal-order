// 점주 '오픈 준비' 퀘스트 — 타임라인(제목 쭉) + 진행률. 100%면 발주가 열린다.
import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
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
          ? { label: "내 완료 필요", cls: "badge--wait" }
          : { label: "대기", cls: "" };

  return (
    <>
      <Topbar brand="핫딜마켓" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <h1 className="h1" style={{ marginBottom: 6 }}>
          오픈 준비
        </h1>
        <p className="hint" style={{ marginBottom: 14 }}>
          아래 준비가 모두 끝나면 발주가 열려요. 완료한 항목을 눌러 체크해 주세요.
        </p>

        {/* 진행률 */}
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="spread" style={{ marginBottom: 8, alignItems: "baseline" }}>
            <b style={{ fontSize: 15 }}>진행률</b>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>
              {view.confirmedCount}/{view.total} · {view.percent}%
            </span>
          </div>
          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: "var(--surface, #eceeec)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${view.percent}%`,
                height: "100%",
                background: "var(--brand, #14532d)",
                transition: "width .3s",
              }}
            />
          </div>
        </div>

        {/* 타임라인 */}
        <div className="list">
          {view.steps.map((s) => {
            const st = statusOf(s);
            return (
              <Link
                key={s.id}
                href={`/onboarding/${s.id}`}
                className="row"
                style={{ textDecoration: "none", alignItems: "center" }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 800,
                    fontSize: 13,
                    marginRight: 10,
                    color: s.confirmed ? "#fff" : "var(--fg)",
                    background: s.confirmed
                      ? "var(--brand, #14532d)"
                      : "var(--surface, #eceeec)",
                  }}
                >
                  {s.confirmed ? "✓" : s.order}
                </span>
                <div className="row__main">
                  <div className="row__title">{s.title}</div>
                </div>
                <span className={`badge ${st.cls}`} style={{ flexShrink: 0 }}>
                  {st.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
