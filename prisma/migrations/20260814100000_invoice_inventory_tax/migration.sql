-- 과세/면세 구분 + 부가세(세액) 표시 기반: 재고·계산서 항목에 tax 컬럼 추가(과세/면세/미선택="")
ALTER TABLE "InventoryItem" ADD COLUMN "tax" TEXT NOT NULL DEFAULT '';
ALTER TABLE "InvoiceItem"   ADD COLUMN "tax" TEXT NOT NULL DEFAULT '';
