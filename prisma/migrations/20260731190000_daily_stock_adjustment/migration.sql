-- CreateTable
CREATE TABLE "DailyStockAdjustment" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyStockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyStockAdjustment_date_itemName_key" ON "DailyStockAdjustment"("date", "itemName");
