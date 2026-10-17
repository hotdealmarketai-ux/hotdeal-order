-- 공산품 '발주 단위(몇 개씩)'를 없애고 최소 수량(MOQ) 하나로 합침(2026-10-17).
--  · 발주 단위가 2 이상이던 상품은 그 값을 최소 수량으로 옮긴다(이미 더 큰 최소가 있으면 그대로).
--  · 발주 단위 칸은 1로 되돌린다. 칸 자체는 남겨 둔다 — 배포하는 동안 옛 서버가 이 칸을 읽어도 오류가 나지 않게.
UPDATE "ReservationProduct"
SET "minPerStore" = GREATEST(COALESCE("minPerStore", 0), "qtyStep"),
    "qtyStep" = 1
WHERE "qtyStep" > 1;

-- 재고 고정은 재고 연동 단일 상품만 — 수기 상품·세트는 꺼 둔다.
UPDATE "ReservationProduct"
SET "stockFixed" = false
WHERE "stockFixed" = true
  AND ("inventoryItemId" = '' OR EXISTS (SELECT 1 FROM "ReservationProductComponent" c WHERE c."productId" = "ReservationProduct"."id"));
