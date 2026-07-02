-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "manualPaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "splitRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "splitRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "orderUnlock" BOOLEAN NOT NULL DEFAULT false;
