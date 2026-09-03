-- 지점별 예약발주 노출 on/off. 기본 true(기존 지점은 그대로 예약발주 사용).
-- AlterTable
ALTER TABLE "User" ADD COLUMN "reservationEnabled" BOOLEAN NOT NULL DEFAULT true;
