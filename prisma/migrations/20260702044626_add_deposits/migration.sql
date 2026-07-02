-- AlterTable
ALTER TABLE "User" ADD COLUMN     "payerNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "bankTid" TEXT NOT NULL,
    "txAt" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "payerName" TEXT NOT NULL DEFAULT '',
    "memo" TEXT NOT NULL DEFAULT '',
    "balanceAfter" INTEGER,
    "matchStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "matchedUserId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_bankTid_key" ON "Deposit"("bankTid");

-- CreateIndex
CREATE INDEX "Deposit_matchStatus_txAt_idx" ON "Deposit"("matchStatus", "txAt");

-- CreateIndex
CREATE INDEX "Deposit_matchedUserId_idx" ON "Deposit"("matchedUserId");

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_matchedUserId_fkey" FOREIGN KEY ("matchedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
