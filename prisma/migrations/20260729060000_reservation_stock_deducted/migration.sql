-- 예약분 픽업 시점 기준재고 차감 추적(nullable, 추가전용). null=미차감.
-- tick 크론이 픽업일 오전10시 지난 연동 예약분을 InventoryItem.qty에서 1회 차감하고 채운다.
-- AlterTable
ALTER TABLE "ReservationOrderItem" ADD COLUMN     "stockDeductedAt" TIMESTAMP(3);
