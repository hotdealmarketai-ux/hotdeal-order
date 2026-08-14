-- 채움채 상품(박스입수·낱개단가·과세면세) — 상품관리 + 계산서 박스→낱개 환산
CREATE TABLE "ChaeumchaeProduct" (
    "id" TEXT NOT NULL,
    "seq" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "hasBox" BOOLEAN NOT NULL DEFAULT true,
    "perBox" INTEGER NOT NULL DEFAULT 1,
    "piecePrice" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT '개',
    "tax" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChaeumchaeProduct_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChaeumchaeProduct_active_sortOrder_idx" ON "ChaeumchaeProduct"("active", "sortOrder");

-- 초기 4종 시드(맑은결 제외) — 값은 상품관리에서 수정 가능. 발주박스→계산서낱개 환산 기준.
INSERT INTO "ChaeumchaeProduct" ("id","seq","name","hasBox","perBox","piecePrice","unit","tax","sortOrder","active","createdAt","updatedAt") VALUES
  ('ccp_gangneung_dubu',   '100040', '강릉두부 500g',              true,  12, 1900, '개', 'EXEMPT', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccp_bongji_kong',      '100013', '비타 수입 봉지콩 300g 아삭통통', true,  20, 1000, '개', 'EXEMPT', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccp_bongji_sukju',     '100056', '아삭채움 숙주봉지 500g',       true,  10, 1500, '개', 'EXEMPT', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccp_gangneung_sundubu','100042', '강릉순두부 600g 몽글',         false, 1,  0,    '개', 'EXEMPT', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
