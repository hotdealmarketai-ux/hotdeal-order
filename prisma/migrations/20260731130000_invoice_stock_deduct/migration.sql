-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "stockDeductedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "inventoryItemId" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "InvoiceItem_inventoryItemId_idx" ON "InvoiceItem"("inventoryItemId");
