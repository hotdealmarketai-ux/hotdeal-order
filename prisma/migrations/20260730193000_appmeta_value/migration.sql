-- 창고 실물재고 스냅샷 등 키-값 저장용 컬럼.
ALTER TABLE "AppMeta" ADD COLUMN IF NOT EXISTS "value" TEXT NOT NULL DEFAULT '';
