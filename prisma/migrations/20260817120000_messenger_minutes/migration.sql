-- CreateTable
CREATE TABLE "MessengerMinutes" (
    "id" TEXT NOT NULL,
    "meetingDate" TIMESTAMP(3) NOT NULL,
    "agenda" TEXT,
    "imageUrls" TEXT[],
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessengerMinutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessengerMinutesRead" (
    "id" TEXT NOT NULL,
    "minutesId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessengerMinutesRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessengerMinutes_meetingDate_idx" ON "MessengerMinutes"("meetingDate");

-- CreateIndex
CREATE INDEX "MessengerMinutesRead_minutesId_idx" ON "MessengerMinutesRead"("minutesId");

-- CreateIndex
CREATE UNIQUE INDEX "MessengerMinutesRead_minutesId_memberId_key" ON "MessengerMinutesRead"("minutesId", "memberId");

-- AddForeignKey
ALTER TABLE "MessengerMinutesRead" ADD CONSTRAINT "MessengerMinutesRead_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "MessengerMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
