-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "windowKey" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "inventoryItemId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "planItemId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "StockHold" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'CART';

-- CreateTable
CREATE TABLE "OrderPlan" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "hiddenSeqs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "stockQty" INTEGER,
    "maxPerStore" INTEGER,
    "minPerStore" INTEGER,
    "inventoryItemId" TEXT NOT NULL DEFAULT '',
    "supplyPrice" INTEGER NOT NULL DEFAULT 0,
    "tax" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderPlan_date_idx" ON "OrderPlan"("date");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPlan_date_category_key" ON "OrderPlan"("date", "category");

-- CreateIndex
CREATE INDEX "OrderPlanItem_planId_sortOrder_idx" ON "OrderPlanItem"("planId", "sortOrder");

-- CreateIndex
CREATE INDEX "OrderPlanItem_date_category_idx" ON "OrderPlanItem"("date", "category");

-- CreateIndex
CREATE INDEX "OrderPlanItem_inventoryItemId_idx" ON "OrderPlanItem"("inventoryItemId");

-- CreateIndex
CREATE INDEX "Order_windowKey_category_idx" ON "Order"("windowKey", "category");

-- CreateIndex
CREATE INDEX "OrderItem_planItemId_idx" ON "OrderItem"("planItemId");

-- AddForeignKey
ALTER TABLE "OrderPlanItem" ADD CONSTRAINT "OrderPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "OrderPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

