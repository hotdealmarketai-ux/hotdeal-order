-- CreateTable
CREATE TABLE "AppMeta" (
    "key" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppMeta_pkey" PRIMARY KEY ("key")
);
