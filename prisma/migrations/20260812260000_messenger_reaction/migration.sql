-- 메시지 공감(체크) 반응
CREATE TABLE "MessengerReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessengerReaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MessengerReaction_messageId_memberId_key" ON "MessengerReaction"("messageId", "memberId");
CREATE INDEX "MessengerReaction_messageId_idx" ON "MessengerReaction"("messageId");
