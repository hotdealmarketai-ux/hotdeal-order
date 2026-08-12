-- 메신저 웹푸시 구독(멤버 단위)
CREATE TABLE "MessengerPushSubscription" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessengerPushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MessengerPushSubscription_endpoint_key" ON "MessengerPushSubscription"("endpoint");
CREATE INDEX "MessengerPushSubscription_memberId_idx" ON "MessengerPushSubscription"("memberId");
