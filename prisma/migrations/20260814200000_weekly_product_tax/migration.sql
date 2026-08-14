-- 주간발주 상품(WeeklyProduct)에 과세/면세 컬럼 추가 — 상품관리에서 설정, 계산서 세액에 반영
ALTER TABLE "WeeklyProduct" ADD COLUMN "tax" TEXT NOT NULL DEFAULT '';
