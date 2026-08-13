-- 반복(기본) 할일 + 날짜별 완료(자정 자동 리셋)
CREATE TABLE "MessengerRecurringTask" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 127,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessengerRecurringTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MessengerRecurringTask_memberId_sortOrder_idx" ON "MessengerRecurringTask"("memberId", "sortOrder");

CREATE TABLE "MessengerRecurringCompletion" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessengerRecurringCompletion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MessengerRecurringCompletion_taskId_date_key" ON "MessengerRecurringCompletion"("taskId", "date");
CREATE INDEX "MessengerRecurringCompletion_taskId_idx" ON "MessengerRecurringCompletion"("taskId");
