-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "appliedInvoiceId" TEXT;

-- CreateIndex
CREATE INDEX "Deposit_appliedInvoiceId_idx" ON "Deposit"("appliedInvoiceId");
