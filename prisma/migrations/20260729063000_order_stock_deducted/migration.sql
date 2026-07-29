-- 공구 발주분 기준재고 차감 추적(nullable, 추가전용). null=미차감.
-- 8시 마감 정산/미리보기 적용이 채우고, 취소 복구는 이 값이 있을 때만 base 되돌림.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "stockDeductedAt" TIMESTAMP(3);
