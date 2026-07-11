-- 주간발주(WeeklyOrder/WeeklyOrderItem) + Invoice.kind(DAILY|WEEKLY) + User 주간 잠금해제 플래그

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "weeklyOrderUnlock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weeklyOrderUnlockAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'DAILY';

-- CreateTable
CREATE TABLE "WeeklyOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyOrderItem" (
    "id" TEXT NOT NULL,
    "weeklyOrderId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "boxUnit" TEXT NOT NULL DEFAULT '',
    "qty" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WeeklyOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyOrder_weekKey_createdAt_idx" ON "WeeklyOrder"("weekKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyOrder_userId_weekKey_key" ON "WeeklyOrder"("userId", "weekKey");

-- CreateIndex
CREATE INDEX "Invoice_userId_kind_status_idx" ON "Invoice"("userId", "kind", "status");

-- AddForeignKey
ALTER TABLE "WeeklyOrder" ADD CONSTRAINT "WeeklyOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyOrderItem" ADD CONSTRAINT "WeeklyOrderItem_weeklyOrderId_fkey" FOREIGN KEY ("weeklyOrderId") REFERENCES "WeeklyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 부분 유니크 인덱스에 kind 추가 — 같은 점포·같은 날짜라도 일일(DAILY)/주간(WEEKLY) 계산서가
-- 공존할 수 있게(옛 인덱스는 (userId,date)라 충돌). 여전히 kind별로 취소 안 된 계산서는 1장.
DROP INDEX IF EXISTS "Invoice_userId_date_active_key";
CREATE UNIQUE INDEX "Invoice_userId_date_kind_active_key"
  ON "Invoice"("userId", "date", "kind")
  WHERE "status" <> 'VOID';
