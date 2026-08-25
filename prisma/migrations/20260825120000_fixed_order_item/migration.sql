-- CreateTable
CREATE TABLE "FixedOrderItem" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixedOrderItem_category_sortOrder_idx" ON "FixedOrderItem"("category", "sortOrder");
