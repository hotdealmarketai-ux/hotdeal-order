-- 예약발주 세트 상품 구성품 테이블 (세트 1개 = 구성품 N개)
CREATE TABLE "ReservationProductComponent" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL DEFAULT '',
    "qtyPerUnit" INTEGER NOT NULL DEFAULT 1,
    "supplyPrice" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReservationProductComponent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReservationProductComponent_productId_sortOrder_idx" ON "ReservationProductComponent"("productId", "sortOrder");

CREATE INDEX "ReservationProductComponent_inventoryItemId_idx" ON "ReservationProductComponent"("inventoryItemId");

ALTER TABLE "ReservationProductComponent" ADD CONSTRAINT "ReservationProductComponent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ReservationProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
