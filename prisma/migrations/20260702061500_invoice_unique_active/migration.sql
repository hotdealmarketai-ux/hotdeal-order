-- 같은 점포·같은 날짜에 '취소되지 않은' 계산서는 1장만 (동시 저장 레이스 방지)
CREATE UNIQUE INDEX "Invoice_userId_date_active_key"
  ON "Invoice"("userId", "date")
  WHERE "status" <> 'VOID';
