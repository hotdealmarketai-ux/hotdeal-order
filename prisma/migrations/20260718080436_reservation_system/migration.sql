-- CreateTable
CREATE TABLE "ReservationBatch" (
    "id" TEXT NOT NULL,
    "reserveDate" TEXT NOT NULL,
    "pickupDate" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationProduct" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplyPrice" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationOrder" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplyPrice" INTEGER NOT NULL DEFAULT 0,
    "qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReservationOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReservationBatch_reserveDate_key" ON "ReservationBatch"("reserveDate");

-- CreateIndex
CREATE INDEX "ReservationBatch_active_reserveDate_idx" ON "ReservationBatch"("active", "reserveDate");

-- CreateIndex
CREATE INDEX "ReservationBatch_pickupDate_idx" ON "ReservationBatch"("pickupDate");

-- CreateIndex
CREATE INDEX "ReservationProduct_batchId_active_sortOrder_idx" ON "ReservationProduct"("batchId", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "ReservationOrder_batchId_idx" ON "ReservationOrder"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationOrder_userId_batchId_key" ON "ReservationOrder"("userId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationOrderItem_orderId_productId_key" ON "ReservationOrderItem"("orderId", "productId");

-- AddForeignKey
ALTER TABLE "ReservationProduct" ADD CONSTRAINT "ReservationProduct_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ReservationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationOrder" ADD CONSTRAINT "ReservationOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ReservationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationOrder" ADD CONSTRAINT "ReservationOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationOrderItem" ADD CONSTRAINT "ReservationOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ReservationOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
