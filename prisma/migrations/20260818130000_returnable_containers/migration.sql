-- CreateTable
CREATE TABLE "ReturnableContainer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnableContainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContainerReturn" (
    "id" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL DEFAULT '',
    "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContainerReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnableContainer_active_sortOrder_idx" ON "ReturnableContainer"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "ContainerReturn_containerId_userId_idx" ON "ContainerReturn"("containerId", "userId");

-- CreateIndex
CREATE INDEX "ContainerReturn_userId_idx" ON "ContainerReturn"("userId");

-- AddForeignKey
ALTER TABLE "ContainerReturn" ADD CONSTRAINT "ContainerReturn_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "ReturnableContainer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerReturn" ADD CONSTRAINT "ContainerReturn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed 기본 회수 용기 2종(아이스박스·우유 콘티). 도입 기준일=2026-08-18. 관리자가 페이지에서 수정 가능.
INSERT INTO "ReturnableContainer" ("id", "name", "matchKey", "startDate", "sortOrder", "active")
VALUES
  ('cont_icebox_default', '아이스박스', '아이스박스', '2026-08-18', 0, true),
  ('cont_milkconti_default', '우유 콘티', '우유콘티', '2026-08-18', 1, true);
