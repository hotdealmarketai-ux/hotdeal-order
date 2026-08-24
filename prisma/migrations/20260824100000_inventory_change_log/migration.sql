-- CreateTable
CREATE TABLE "InventoryChangeLog" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'update',
    "before" TEXT NOT NULL DEFAULT '',
    "after" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT NOT NULL DEFAULT '',
    "actorName" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryChangeLog_itemId_createdAt_idx" ON "InventoryChangeLog"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryChangeLog_createdAt_idx" ON "InventoryChangeLog"("createdAt");
