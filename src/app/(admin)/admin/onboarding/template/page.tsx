// 관리자 — 온보딩 체크리스트 내용 편집(제목·본문·담당·필수). 전 점포 공용 마스터.
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { OnboardingTemplateEditor } from "@/components/OnboardingTemplateEditor";

export default async function OnboardingTemplatePage() {
  await requireAdmin();
  const steps = await prisma.onboardingStep.findMany({
    where: { active: true },
    orderBy: { order: "asc" },
    select: {
      id: true,
      order: true,
      title: true,
      body: true,
      actor: true,
      required: true,
    },
  });

  return (
    <>
      <Topbar backHref="/admin/onboarding" title="체크리스트 편집" />
      <div className="page">
        <OnboardingTemplateEditor steps={steps} />
      </div>
    </>
  );
}
