// 관리자 튜토리얼 편집기 — 대/중/소 분류 트리 + 콘텐츠 블록(텍스트·이미지·체크박스) 그리드.
// ?node=<id> 로 분류 안으로 드릴다운. 단일 공용 템플릿(편집 즉시 전 지점 반영).
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { loadNode, getRootNodes } from "@/lib/onboarding";
import { TemplateEditor } from "@/components/onboarding/TemplateEditor";

export default async function TemplatePage(props: {
  searchParams: Promise<{ node?: string }>;
}) {
  await requireAdmin();
  const { node: nodeId } = await props.searchParams;

  const totalChecks = await prisma.onboardingBlock.count({ where: { type: "CHECK" } });

  if (nodeId) {
    const loaded = await loadNode(nodeId);
    if (loaded) {
      return (
        <>
          <Topbar backHref="/admin/onboarding" title="튜토리얼 편집" />
          <div className="page">
            <TemplateEditor
              node={{ id: loaded.node.id, title: loaded.node.title }}
              breadcrumb={loaded.breadcrumb}
              level={loaded.level}
              childrenNodes={loaded.children}
              blocks={loaded.blocks}
              totalChecks={totalChecks}
            />
          </div>
        </>
      );
    }
  }

  // 루트 — 대분류 목록
  const roots = await getRootNodes();
  return (
    <>
      <Topbar backHref="/admin/onboarding" title="튜토리얼 편집" />
      <div className="page">
        <TemplateEditor
          node={null}
          breadcrumb={[]}
          level={0}
          childrenNodes={roots}
          blocks={[]}
          totalChecks={totalChecks}
        />
      </div>
    </>
  );
}
