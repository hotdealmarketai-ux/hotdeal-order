-- CreateTable
CREATE TABLE "ReceivableAdjustment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceivableAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationChangeLog" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL DEFAULT '',
    "changes" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceivableAdjustment_userId_createdAt_idx" ON "ReceivableAdjustment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReservationChangeLog_batchId_userId_createdAt_idx" ON "ReservationChangeLog"("batchId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReceivableAdjustment" ADD CONSTRAINT "ReceivableAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
