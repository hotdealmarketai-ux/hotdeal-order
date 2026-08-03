-- 예약발주 재구조화 Phase 1 (순수 additive — 현재 동작 무변경).
-- 상품별 마감(closeAt, 시분초) + 품목별 확정(confirmedAt) 컬럼 추가.

-- AlterTable
ALTER TABLE "ReservationProduct" ADD COLUMN "closeAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ReservationOrderItem" ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ReservationProduct_active_closeAt_idx" ON "ReservationProduct"("active", "closeAt");

-- 백필: 기존 확정 주문의 각 품목 confirmedAt = 주문 확정시각(없으면 갱신시각).
-- Phase 4에서 공구 자동로드 게이트를 order.confirmed → item.confirmedAt 로 전환할 때 현재 동작 100% 보존.
UPDATE "ReservationOrderItem" i
SET "confirmedAt" = COALESCE(o."confirmedAt", o."updatedAt")
FROM "ReservationOrder" o
WHERE i."orderId" = o."id" AND o."confirmed" = true;
