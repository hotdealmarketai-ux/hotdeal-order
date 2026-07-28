-- AlterTable
ALTER TABLE "ReservationOrderItem" ADD COLUMN     "inventoryItemId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ReservationProduct" ADD COLUMN     "inventoryItemId" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "ReservationOrderItem_inventoryItemId_idx" ON "ReservationOrderItem"("inventoryItemId");

