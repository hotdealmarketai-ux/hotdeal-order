-- PC 창고관리 전용 admin/1234(WAREHOUSE) 계정 제거 — 창고관리는 새롭 관리자 계정 + 비밀번호(1234) 게이트로 이관.
-- 이 계정은 발주/주간/예약/계산서/알림 등 업무 데이터가 없어야 정상이지만, 운영 DB에 혹시 남은
-- 참조행이 FK(Restrict)로 삭제를 막지 않도록 방어적으로 함께 정리한다(있으면 삭제, 없으면 no-op).
-- StockHold·PushSubscription·ChatThread(=Cascade), Deposit.matchedUserId(=SetNull) 은 User 삭제 시 자동 처리.
DO $$
DECLARE wid text;
BEGIN
  SELECT id INTO wid FROM "User" WHERE "username" = 'admin' AND "role" = 'WAREHOUSE' LIMIT 1;
  IF wid IS NOT NULL THEN
    DELETE FROM "Order" WHERE "userId" = wid;             -- OrderItem 은 orderId Cascade
    DELETE FROM "WeeklyOrder" WHERE "userId" = wid;       -- WeeklyOrderItem 은 weeklyOrderId Cascade
    DELETE FROM "ReservationOrder" WHERE "userId" = wid;  -- ReservationOrderItem 은 orderId Cascade
    DELETE FROM "Invoice" WHERE "userId" = wid;           -- InvoiceItem 은 invoiceId Cascade
    DELETE FROM "Notification" WHERE "userId" = wid;
    DELETE FROM "User" WHERE id = wid;
  END IF;
END $$;
