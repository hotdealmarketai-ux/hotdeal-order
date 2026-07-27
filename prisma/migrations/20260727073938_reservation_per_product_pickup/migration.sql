-- AlterTable
ALTER TABLE "ReservationOrderItem" ADD COLUMN     "pickupDate" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ReservationProduct" ADD COLUMN     "pickupDate" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "ReservationOrderItem_pickupDate_idx" ON "ReservationOrderItem"("pickupDate");

-- Backfill(운영 데이터 보존): 기존 상품은 소속 배치의 픽업일을 상속받아 기존 동작을 그대로 유지.
UPDATE "ReservationProduct" p
SET "pickupDate" = b."pickupDate"
FROM "ReservationBatch" b
WHERE p."batchId" = b."id" AND p."pickupDate" = '';

-- Backfill: 기존 확정 주문아이템은 주문→배치의 픽업일을 스냅샷으로 상속(자동로드 정합 유지).
UPDATE "ReservationOrderItem" i
SET "pickupDate" = b."pickupDate"
FROM "ReservationOrder" o, "ReservationBatch" b
WHERE i."orderId" = o."id" AND o."batchId" = b."id" AND i."pickupDate" = '';
