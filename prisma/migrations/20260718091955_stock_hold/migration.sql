-- CreateTable
CREATE TABLE "StockHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "windowDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockHold_itemId_windowDate_idx" ON "StockHold"("itemId", "windowDate");

-- CreateIndex
CREATE INDEX "StockHold_windowDate_idx" ON "StockHold"("windowDate");

-- CreateIndex
CREATE UNIQUE INDEX "StockHold_userId_itemId_windowDate_key" ON "StockHold"("userId", "itemId", "windowDate");

-- AddForeignKey
ALTER TABLE "StockHold" ADD CONSTRAINT "StockHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
