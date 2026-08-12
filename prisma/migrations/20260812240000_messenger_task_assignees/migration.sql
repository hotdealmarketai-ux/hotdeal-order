-- 할 일 받는 사람 다중 선택
ALTER TABLE "MessengerTask" ADD COLUMN "assigneeIds" TEXT[] NOT NULL DEFAULT '{}';

-- 기존 단일 assigneeId 를 배열로 백필
UPDATE "MessengerTask" SET "assigneeIds" = ARRAY["assigneeId"]
WHERE "assigneeId" IS NOT NULL AND cardinality("assigneeIds") = 0;
