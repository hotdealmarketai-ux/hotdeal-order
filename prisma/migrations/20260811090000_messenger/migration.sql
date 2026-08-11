-- 사내 메신저 — 멤버(2차 로그인 신원)·채널(주제방)·메시지·읽음
-- CreateTable
CREATE TABLE "MessengerMember" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessengerMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessengerChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessengerChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessengerMessage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessengerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessengerRead" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessengerRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessengerMember_active_sortOrder_idx" ON "MessengerMember"("active", "sortOrder");
CREATE INDEX "MessengerChannel_archived_sortOrder_idx" ON "MessengerChannel"("archived", "sortOrder");
CREATE INDEX "MessengerMessage_channelId_createdAt_idx" ON "MessengerMessage"("channelId", "createdAt");
CREATE UNIQUE INDEX "MessengerRead_memberId_channelId_key" ON "MessengerRead"("memberId", "channelId");

-- AddForeignKey
ALTER TABLE "MessengerMessage" ADD CONSTRAINT "MessengerMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "MessengerChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerMessage" ADD CONSTRAINT "MessengerMessage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "MessengerMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerRead" ADD CONSTRAINT "MessengerRead_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "MessengerMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerRead" ADD CONSTRAINT "MessengerRead_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "MessengerChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
