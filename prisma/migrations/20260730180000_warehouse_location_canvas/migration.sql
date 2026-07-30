-- 평면도 크기를 장소(WarehouseLocation)에 저장 → 모든 컴퓨터에서 동일한 입면도(예전 localStorage는 PC마다 달랐음).
ALTER TABLE "WarehouseLocation" ADD COLUMN IF NOT EXISTS "w" INTEGER NOT NULL DEFAULT 1600;
ALTER TABLE "WarehouseLocation" ADD COLUMN IF NOT EXISTS "h" INTEGER NOT NULL DEFAULT 1000;
