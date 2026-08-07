-- CreateTable
CREATE TABLE "OnboardingNode" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingBlock" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "text" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "colSpan" INTEGER NOT NULL DEFAULT 12,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "OnboardingCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingNode_parentId_order_idx" ON "OnboardingNode"("parentId", "order");

-- CreateIndex
CREATE INDEX "OnboardingBlock_nodeId_order_idx" ON "OnboardingBlock"("nodeId", "order");

-- CreateIndex
CREATE INDEX "OnboardingCheck_userId_idx" ON "OnboardingCheck"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingCheck_userId_blockId_key" ON "OnboardingCheck"("userId", "blockId");

-- AddForeignKey
ALTER TABLE "OnboardingNode" ADD CONSTRAINT "OnboardingNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OnboardingNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingBlock" ADD CONSTRAINT "OnboardingBlock_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OnboardingNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingCheck" ADD CONSTRAINT "OnboardingCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingCheck" ADD CONSTRAINT "OnboardingCheck_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "OnboardingBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

