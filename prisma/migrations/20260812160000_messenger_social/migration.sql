-- 할일 받는사람=팀원전체(toAll) + 채팅 답장/공지 + @멘션
ALTER TABLE "MessengerTask" ADD COLUMN "toAll" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MessengerMessage" ADD COLUMN "replyToId" TEXT;
ALTER TABLE "MessengerMessage" ADD COLUMN "replyToName" TEXT;
ALTER TABLE "MessengerMessage" ADD COLUMN "replyToBody" TEXT;
ALTER TABLE "MessengerMessage" ADD COLUMN "noticeAt" TIMESTAMP(3);
CREATE INDEX "MessengerMessage_channelId_noticeAt_idx" ON "MessengerMessage"("channelId", "noticeAt");

CREATE TABLE "MessengerMention" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mentionedMemberId" TEXT NOT NULL,
    "byMemberId" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessengerMention_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MessengerMention_mentionedMemberId_createdAt_idx" ON "MessengerMention"("mentionedMemberId", "createdAt");
CREATE INDEX "MessengerMention_messageId_idx" ON "MessengerMention"("messageId");
