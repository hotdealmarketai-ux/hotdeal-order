-- 사다드림 계산서 전용 입금계좌 스냅샷 3필드(발행 시점 입력). 다른 kind 는 빈 값.
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "sdBank" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sdHolder" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sdAccount" TEXT NOT NULL DEFAULT '';
