-- #2 관리자 1:1 채팅 사진·영상 첨부: ChatMessage에 미디어 컬럼 추가(nullable, 추가전용).
-- 기존 행은 NULL(텍스트 메시지)로 남아 데이터 손실 없음. mediaType = "image" | "video".
-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "mediaUrl" TEXT,
ADD COLUMN     "mediaType" TEXT;
