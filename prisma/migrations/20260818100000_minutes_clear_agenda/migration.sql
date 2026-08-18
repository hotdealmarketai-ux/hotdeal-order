-- 회의록 안건 목차(agenda) 폐지 — 기존 데이터 전부 비움(컬럼은 라이브 구코드 읽기 대비 드롭하지 않음).
UPDATE "MessengerMinutes" SET "agenda" = NULL WHERE "agenda" IS NOT NULL;
