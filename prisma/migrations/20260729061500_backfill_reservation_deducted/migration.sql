-- 소급 차감 방지 백필: 이 기능 배포 시점 기준으로 '오늘(KST) 이전에 픽업이 이미 지난' 예약분은
-- 기준재고에 이미 반영됐다고 보고 stockDeductedAt를 채워 재차감을 막는다.
-- 오늘/미래 픽업분(stockDeductedAt IS NULL 유지)만 픽업일 오전10시에 신규 차감된다.
UPDATE "ReservationOrderItem"
SET "stockDeductedAt" = NOW()
WHERE "stockDeductedAt" IS NULL
  AND "pickupDate" <> ''
  AND "pickupDate" < to_char((now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD');
