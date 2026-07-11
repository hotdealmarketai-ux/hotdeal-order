-- 주간발주 카탈로그 단가 오버라이드(관리자 편집)
CREATE TABLE "WeeklyPrice" (
    "code" TEXT NOT NULL,
    "boxPrice" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyPrice_pkey" PRIMARY KEY ("code")
);
