-- 지점별 '발주 시간 1회 열기' (미수 잠금해제 orderUnlock 과 완전 별개)
-- 발주창(낮12~저녁8시)이 아니어도 이 지점만 이번 창에 한해 일반 발주 허용. 다음 창부터 자동 재잠금.
ALTER TABLE "User" ADD COLUMN     "timeUnlock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN     "timeUnlockAt" TIMESTAMP(3);
