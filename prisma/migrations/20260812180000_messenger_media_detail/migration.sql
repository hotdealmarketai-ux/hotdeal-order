-- 사진 묶어보내기: 메시지에 여러 장 URL
ALTER TABLE "MessengerMessage" ADD COLUMN "mediaUrls" TEXT[] NOT NULL DEFAULT '{}';

-- 멘션 확인(읽음) 시각 — null이면 홈 '받은 멘션'에 노출
ALTER TABLE "MessengerMention" ADD COLUMN "readAt" TIMESTAMP(3);

-- 할일 상세 설명
ALTER TABLE "MessengerTask" ADD COLUMN "detail" TEXT;
