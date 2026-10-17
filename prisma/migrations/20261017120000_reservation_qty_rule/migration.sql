-- 공산품(예약 상품) 수량 규칙 — 지점당 최소 · 몇 개씩 · 점주 안내 한 줄.
-- 칸만 더함(기존 상품 = 규칙 없음 · 낱개 · 안내 없음 → 지금과 같은 동작).
ALTER TABLE "ReservationProduct" ADD COLUMN "minPerStore" INTEGER;
ALTER TABLE "ReservationProduct" ADD COLUMN "qtyStep" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ReservationProduct" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
