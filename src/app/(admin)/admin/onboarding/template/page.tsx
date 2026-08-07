// 관리자 튜토리얼 편집기 — 분류 트리(대/중/소). 각 분류=체크박스, 설명·이미지 첨부.
// ?node=<id> 로 분류 안으로 드릴다운. 단일 공용 템플릿(편집 즉시 전 지점 반영).
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { loadNode, getRootNodes } from "@/lib/onboarding";
import { TemplateEditor } from "@/components/onboarding/TemplateEditor";

export default async function TemplatePage(props: {
  searchParams: Promise<{ node?: string }>;
}) {
  await requireAdmin();
  const { node: nodeId } = await props.searchParams;

  if (nodeId) {
    const loaded = await loadNode(nodeId);
    if (loaded) {
      return (
        <>
          <Topbar backHref="/admin/onboarding" title="튜토리얼 편집" />
          <div className="page">
            <TemplateEditor
              node={loaded.node}
              breadcrumb={loaded.breadcrumb}
              level={loaded.level}
              childrenNodes={loaded.children}
            />
          </div>
        </>
      );
    }
  }

  const roots = await getRootNodes();
  return (
    <>
      <Topbar backHref="/admin/onboarding" title="튜토리얼 편집" />
      <div className="page">
        <TemplateEditor node={null} breadcrumb={[]} level={0} childrenNodes={roots} />
      </div>
    </>
  );
}
