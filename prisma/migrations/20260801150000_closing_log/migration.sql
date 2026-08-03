-- CreateTable
CREATE TABLE "ClosingLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL DEFAULT '',
    "storeCount" INTEGER NOT NULL DEFAULT 0,
    "receivableTotal" INTEGER NOT NULL DEFAULT 0,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "invoiceItemCount" INTEGER NOT NULL DEFAULT 0,
    "inventoryCount" INTEGER NOT NULL DEFAULT 0,
    "snapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClosingLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClosingLog_createdAt_idx" ON "ClosingLog"("createdAt");
