-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "supplyPrice" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "confirmedCats" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    "type" TEXT NOT NULL DEFAULT '',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
