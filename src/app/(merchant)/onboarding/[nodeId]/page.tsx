// 점주 튜토리얼 분류 상세 — 블록(텍스트·이미지·체크박스) + 하위 분류 카드.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { needsOnboarding, loadNode, getUserChecks } from "@/lib/onboarding";
import { OnbBlockView } from "@/components/onboarding/OnbBlockView";

export default async function OnboardingNodePage(props: {
  params: Promise<{ nodeId: string }>;
}) {
  const user = await requireMerchant();
  if (!needsOnboarding(user)) redirect("/order");
  const { nodeId } = await props.params;

  const loaded = await loadNode(nodeId);
  if (!loaded) notFound();

  const checkIds = loaded.blocks.filter((b) => b.type === "CHECK").map((b) => b.id);
  const checked = await getUserChecks(user.id, checkIds);

  const parent = loaded.node.parentId;

  return (
    <>
      <Topbar backHref="/onboarding" title="오픈 준비" />
      <div className="page">
        <div className="onbcrumb">
          <Link href="/onboarding" className="onbcrumb__link">
            오픈 준비
          </Link>
          {loaded.breadcrumb.map((c, i) => (
            <span key={c.id} className="onbcrumb__seg">
              <span className="onbcrumb__sep">›</span>
              {i === loaded.breadcrumb.length - 1 ? (
                <span className="onbcrumb__cur">{c.title || "(제목 없음)"}</span>
              ) : (
                <Link href={`/onboarding/${c.id}`} className="onbcrumb__link">
                  {c.title || "(제목 없음)"}
                </Link>
              )}
            </span>
          ))}
        </div>

        <h1 className="h1" style={{ marginBottom: 14 }}>
          {loaded.node.title || "(제목 없음)"}
        </h1>

        <OnbBlockView blocks={loaded.blocks} checked={checked} />

        {loaded.children.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 20 }}>
              세부 항목
            </div>
            <div className="list">
              {loaded.children.map((c) => (
                <Link
                  key={c.id}
                  href={`/onboarding/${c.id}`}
                  className="row"
                  style={{ textDecoration: "none", alignItems: "center" }}
                >
                  <div className="row__main">
                    <div className="row__title">{c.title || "(제목 없음)"}</div>
                  </div>
                  <span className="onbstep__chev" aria-hidden>
                    ›
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        {loaded.blocks.length === 0 && loaded.children.length === 0 && (
          <div className="empty">준비 중이에요.</div>
        )}

        <div style={{ marginTop: 20 }}>
          <Link
            href={parent ? `/onboarding/${parent}` : "/onboarding"}
            className="btn btn--soft btn--block"
          >
            뒤로
          </Link>
        </div>
      </div>
    </>
  );
}
