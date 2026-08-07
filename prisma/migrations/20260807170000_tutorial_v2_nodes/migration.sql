-- AlterTable
ALTER TABLE "OnboardingNode" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "OnboardingApproval" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "OnboardingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingApproval_userId_idx" ON "OnboardingApproval"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingApproval_userId_nodeId_key" ON "OnboardingApproval"("userId", "nodeId");

-- AddForeignKey
ALTER TABLE "OnboardingApproval" ADD CONSTRAINT "OnboardingApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingApproval" ADD CONSTRAINT "OnboardingApproval_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OnboardingNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 컷오버 정리: v1(구 시스템)에서 시작돼 미완료인 진행 중 지점을 초기화한다.
-- v2 진행률은 신설 OnboardingApproval(비어있음) 기준이라, 리셋하지 않으면 잠긴 채 남는다.
-- 이 시점(v2 배포)엔 v2로 시작된 지점이 없으므로 v1 진행분만 대상이 되어 안전(발주 잠금 해제).
UPDATE "User" SET "onboardingStartedAt" = NULL
 WHERE "onboardingStartedAt" IS NOT NULL AND "onboardingCompletedAt" IS NULL;
