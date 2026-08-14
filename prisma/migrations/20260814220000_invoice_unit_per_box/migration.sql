-- 채움채 낱개환산 마커 — InvoiceItem에 박스당 낱개입수 저장(0=박스/일반). 이중청구 델타 단위정합용.
ALTER TABLE "InvoiceItem" ADD COLUMN "unitPerBox" INTEGER NOT NULL DEFAULT 0;
