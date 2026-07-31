-- 계산서 기준 재고 차감 전환 백필 (1회).
-- 배포 시점(KST 오늘)까지의 출고일 일일 계산서는 기존 '8시 발주 자동차감'으로 이미 처리됐다.
-- 이들에 stockDeductedAt를 채워, 앞으로 발행/수정돼도 계산서 기준 차감이 '재차감(이중차감)'하지 않게 한다.
-- (KST 내일 출고분부터는 stockDeductedAt=null 그대로 → 계산서 발행 시 정상 차감.)
UPDATE "Invoice"
SET "stockDeductedAt" = NOW()
WHERE "kind" = 'DAILY'
  AND "stockDeductedAt" IS NULL
  AND "date" <= to_char((NOW() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD');
