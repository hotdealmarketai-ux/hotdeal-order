-- #9 재고 유통기한: InventoryItem에 expiry 컬럼 추가(YYYY-MM-DD, 빈값=없음).
-- 추가 컬럼 + DEFAULT '' → 기존 행은 자동으로 ''(유통기한 없음)로 백필. 데이터 손실 없음.
-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "expiry" TEXT NOT NULL DEFAULT '';
