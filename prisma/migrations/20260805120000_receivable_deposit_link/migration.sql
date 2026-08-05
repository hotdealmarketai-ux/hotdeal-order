-- 입금 매칭으로 생성된 미수 조정을 그 입금(Deposit)에 연결. 매칭 해제 시 이 조정을 지워 원복.
-- unique = 한 입금당 조정 1건(멱등). 기존 수동 조정 행은 모두 null.
ALTER TABLE "ReceivableAdjustment" ADD COLUMN "depositId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ReceivableAdjustment_depositId_key" ON "ReceivableAdjustment"("depositId");
