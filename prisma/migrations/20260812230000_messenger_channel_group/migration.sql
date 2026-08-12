-- 채널 그룹(단 나누기)
CREATE TABLE "MessengerChannelGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessengerChannelGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MessengerChannelGroup_sortOrder_idx" ON "MessengerChannelGroup"("sortOrder");

-- 채널 → 그룹 소속(관계없는 String)
ALTER TABLE "MessengerChannel" ADD COLUMN "groupId" TEXT;
