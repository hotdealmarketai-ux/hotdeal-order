-- CreateTable
CREATE TABLE "InboundLog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "supplyPrice" INTEGER NOT NULL DEFAULT 0,
    "expiry" TEXT NOT NULL DEFAULT '',
    "majorCat" TEXT NOT NULL DEFAULT '',
    "itemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboundLog_createdAt_idx" ON "InboundLog"("createdAt");

-- CreateIndex
CREATE INDEX "InboundLog_name_idx" ON "InboundLog"("name");
