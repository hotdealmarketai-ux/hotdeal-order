-- 창고 장소 관리(추가/이름변경/삭제). 기본 3개는 기존 키를 id로 시드 → 기존 WarehouseBox.location(FLOOR1/FREEZER/FRIDGE) 보존.
-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseLocation_sortOrder_idx" ON "WarehouseLocation"("sortOrder");

-- Seed 기본 3개(기존 키=id)
INSERT INTO "WarehouseLocation" ("id", "name", "sortOrder") VALUES
    ('FLOOR1', '1층', 0),
    ('FREEZER', '냉동고', 1),
    ('FRIDGE', '냉장고', 2)
ON CONFLICT ("id") DO NOTHING;
