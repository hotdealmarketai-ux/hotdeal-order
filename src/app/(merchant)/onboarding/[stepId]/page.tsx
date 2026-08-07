// 점주 온보딩 단계 상세 — 본사가 작성한 내용·이미지 + '완료했어요' + 본사 확인 상태.
import { notFound, redirect } from "next/navigation";
import Image from "next/image";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { needsOnboarding } from "@/lib/onboarding";
import { OnboardingCheckButton } from "@/components/OnboardingCheckButton";

const ACTOR_LABEL: Record<string, string> = {
  MERCHANT: "점주",
  ADMIN: "본사",
  BOTH: "점주·본사",
};

export default async function OnboardingStepPage(props: {
  params: Promise<{ stepId: string }>;
}) {
  const user = await requireMerchant();
  if (!needsOnboarding(user)) redirect("/order");
  const { stepId } = await props.params;

  const [step, item] = await Promise.all([
    prisma.onboardingStep.findUnique({ where: { id: stepId } }),
    prisma.onboardingItem.findUnique({
      where: { userId_stepId: { userId: user.id, stepId } },
    }),
  ]);
  if (!step || !step.active) notFound();

  const merchantDone = !!item?.merchantDoneAt;
  const adminDone = !!item?.adminDoneAt;
  const confirmed = merchantDone && adminDone;

  return (
    <>
      <Topbar backHref="/onboarding" title="오픈 준비" />
      <div className="page">
        <div className="spread" style={{ marginBottom: 8, alignItems: "center" }}>
          <span className="chip">담당 {ACTOR_LABEL[step.actor] ?? "점주·본사"}</span>
          {confirmed ? (
            <span className="badge badge--ok">완료</span>
          ) : (
            <span className="badge badge--wait">진행 중</span>
          )}
        </div>
        <h1 className="h1" style={{ marginBottom: 12 }}>
          {step.order}. {step.title}
        </h1>

        {step.body && (
          <div className="card" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
            {step.body}
          </div>
        )}

        {step.images.length > 0 && (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {step.images.map((src, i) => (
              <Image
                key={i}
                src={src}
                alt={`${step.title} 안내 이미지 ${i + 1}`}
                width={900}
                height={600}
                style={{ width: "100%", height: "auto", borderRadius: 12 }}
                unoptimized
              />
            ))}
          </div>
        )}

        {/* 확인 상태 */}
        <div className="card" style={{ marginTop: 14 }}>
          <div className="kv">
            <span className="kv__k">내 완료</span>
            <span className="kv__v">{merchantDone ? "✓ 완료" : "대기"}</span>
          </div>
          <div className="kv">
            <span className="kv__k">본사 확인</span>
            <span className="kv__v">
              {adminDone ? `✓ 확인${item?.adminBy ? ` · ${item.adminBy}` : ""}` : "대기"}
            </span>
          </div>
        </div>

        <OnboardingCheckButton stepId={step.id} done={merchantDone} />
      </div>
    </>
  );
}
