-- CreateTable
CREATE TABLE "WarehouseBox" (
    "id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "itemId" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "x" INTEGER NOT NULL DEFAULT 40,
    "y" INTEGER NOT NULL DEFAULT 40,
    "w" INTEGER NOT NULL DEFAULT 140,
    "h" INTEGER NOT NULL DEFAULT 90,
    "color" TEXT NOT NULL DEFAULT '',
    "z" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseBox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseBox_location_idx" ON "WarehouseBox"("location");
