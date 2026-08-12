-- 채널 즐겨찾기(팀 공용)
ALTER TABLE "MessengerChannel" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false;
