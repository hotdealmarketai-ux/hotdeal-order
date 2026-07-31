-- 재고 마감 조정: 절대 출고량(qty) → 보정치(correction)로 의미 변경. 값 없던 신규 테이블이라 rename로 충분.
ALTER TABLE "DailyStockAdjustment" RENAME COLUMN "qty" TO "correction";
