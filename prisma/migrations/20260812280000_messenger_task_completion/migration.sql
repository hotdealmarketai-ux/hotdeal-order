-- 할 일 개인별 완료
CREATE TABLE "MessengerTaskCompletion" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessengerTaskCompletion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MessengerTaskCompletion_taskId_memberId_key" ON "MessengerTaskCompletion"("taskId", "memberId");
CREATE INDEX "MessengerTaskCompletion_taskId_idx" ON "MessengerTaskCompletion"("taskId");

-- 백필: 기존 done=true 태스크는 배정자들의 완료로 이관(다중/단일), 배정 없으면 작성자로.
INSERT INTO "MessengerTaskCompletion" (id, "taskId", "memberId", "completedAt")
SELECT gen_random_uuid()::text, t.id, m, COALESCE(t."doneAt", now())
FROM "MessengerTask" t, unnest(t."assigneeIds") AS m
WHERE t.done = true AND cardinality(t."assigneeIds") > 0
ON CONFLICT DO NOTHING;

INSERT INTO "MessengerTaskCompletion" (id, "taskId", "memberId", "completedAt")
SELECT gen_random_uuid()::text, t.id, t."createdById", COALESCE(t."doneAt", now())
FROM "MessengerTask" t
WHERE t.done = true AND cardinality(t."assigneeIds") = 0
ON CONFLICT DO NOTHING;
