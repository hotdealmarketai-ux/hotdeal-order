-- 계산서 품목 표시 단위(주간발주 합산분만: "박스"/"판"). 일반 품목은 빈값. 추가전용·안전.
-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "unit" TEXT NOT NULL DEFAULT '';
