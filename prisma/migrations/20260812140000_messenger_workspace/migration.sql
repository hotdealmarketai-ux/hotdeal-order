-- 사내 메신저 워크스페이스: 할일(MessengerTask) + 팀 캘린더(MessengerEvent). 팀 전체 공용, 관계 없이 멤버 id 문자열 보관.
-- CreateTable
CREATE TABLE "MessengerTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),
    CONSTRAINT "MessengerTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessengerEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessengerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessengerTask_done_createdAt_idx" ON "MessengerTask"("done", "createdAt");
CREATE INDEX "MessengerTask_dueDate_idx" ON "MessengerTask"("dueDate");
CREATE INDEX "MessengerEvent_date_idx" ON "MessengerEvent"("date");
