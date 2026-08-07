-- CreateTable
CREATE TABLE "SourcingLead" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "storeCount" INTEGER,
    "isFranchise" BOOLEAN NOT NULL DEFAULT false,
    "reviewCount" INTEGER,
    "trendScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "instagram" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcingLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingProduct" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "price" INTEGER,
    "reviewCount" INTEGER,
    "prevReviewCount" INTEGER,
    "reviewVelocity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "demandScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isBigBrand" BOOLEAN NOT NULL DEFAULT false,
    "marginEst" INTEGER,
    "url" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcingProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingRun" (
    "id" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "found" INTEGER NOT NULL DEFAULT 0,
    "kept" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SourcingRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourcingLead_key_key" ON "SourcingLead"("key");

-- CreateIndex
CREATE INDEX "SourcingLead_status_trendScore_idx" ON "SourcingLead"("status", "trendScore");

-- CreateIndex
CREATE INDEX "SourcingLead_lastSeenAt_idx" ON "SourcingLead"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourcingProduct_key_key" ON "SourcingProduct"("key");

-- CreateIndex
CREATE INDEX "SourcingProduct_status_demandScore_idx" ON "SourcingProduct"("status", "demandScore");

-- CreateIndex
CREATE INDEX "SourcingProduct_lastSeenAt_idx" ON "SourcingProduct"("lastSeenAt");

-- CreateIndex
CREATE INDEX "SourcingRun_startedAt_idx" ON "SourcingRun"("startedAt");

