-- 일반 파일 첨부(문서 등)
ALTER TABLE "MessengerMessage" ADD COLUMN "fileUrl" TEXT;
ALTER TABLE "MessengerMessage" ADD COLUMN "fileName" TEXT;
