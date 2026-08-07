// 가맹 오픈 온보딩(퀘스트) — 파생 계산·게이트·완료 판정.
// 이중 확인(A): 각 단계는 점주 완료 + 본사 확인 둘 다여야 '확정'. 필수(required·active) 단계가
// 전부 확정되면 onboardingCompletedAt 세팅 → 발주 오픈. 기존 점주는 startedAt=null이라 무관.
import { prisma } from "@/lib/prisma";

export type OnboardingStepView = {
  id: string;
  order: number;
  title: string;
  body: string;
  images: string[];
  actor: string; // MERCHANT | ADMIN | BOTH
  required: boolean;
  merchantDoneAt: Date | null;
  adminDoneAt: Date | null;
  adminBy: string | null;
  confirmed: boolean; // 점주+본사 둘 다 = 확정
};

export type OnboardingView = {
  steps: OnboardingStepView[];
  total: number; // 필수 단계 수
  confirmedCount: number; // 확정된 필수 단계 수
  percent: number; // 0~100
  complete: boolean; // 전 필수 단계 확정
};

// 온보딩 게이트 대상인가 — 핫딜마켓 & 승인 & 온보딩 시작됨 & 아직 미완료.
export function needsOnboarding(user: {
  role: string;
  status: string;
  onboardingStartedAt: Date | null;
  onboardingCompletedAt: Date | null;
}): boolean {
  return (
    user.role === "MERCHANT_HOTDEAL" &&
    user.status === "APPROVED" &&
    user.onboardingStartedAt != null &&
    user.onboardingCompletedAt == null
  );
}

// 한 점주의 온보딩 뷰(활성 단계 + 그 점주 진행상태 결합).
export async function getOnboardingView(userId: string): Promise<OnboardingView> {
  const [steps, items] = await Promise.all([
    prisma.onboardingStep.findMany({
      where: { active: true },
      orderBy: { order: "asc" },
    }),
    prisma.onboardingItem.findMany({ where: { userId } }),
  ]);
  const byStep = new Map(items.map((it) => [it.stepId, it]));
  const views: OnboardingStepView[] = steps.map((s) => {
    const it = byStep.get(s.id);
    const merchantDoneAt = it?.merchantDoneAt ?? null;
    const adminDoneAt = it?.adminDoneAt ?? null;
    return {
      id: s.id,
      order: s.order,
      title: s.title,
      body: s.body,
      images: s.images,
      actor: s.actor,
      required: s.required,
      merchantDoneAt,
      adminDoneAt,
      adminBy: it?.adminBy ?? null,
      confirmed: !!merchantDoneAt && !!adminDoneAt,
    };
  });
  const required = views.filter((v) => v.required);
  const confirmedCount = required.filter((v) => v.confirmed).length;
  const total = required.length;
  const percent = total === 0 ? 0 : Math.round((confirmedCount / total) * 100);
  return {
    steps: views,
    total,
    confirmedCount,
    percent,
    complete: total > 0 && confirmedCount === total,
  };
}

// 완료 판정 — 필수·활성 단계가 전부 확정이면 onboardingCompletedAt 세팅(멱등). 방금 완료됐으면 true.
export async function maybeCompleteOnboarding(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingStartedAt: true, onboardingCompletedAt: true },
  });
  if (!user || user.onboardingStartedAt == null || user.onboardingCompletedAt != null) {
    return false; // 온보딩 대상 아님 or 이미 완료
  }
  const view = await getOnboardingView(userId);
  if (!view.complete) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingCompletedAt: new Date() },
  });
  return true;
}
