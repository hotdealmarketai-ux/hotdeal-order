import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PASSWORD = "test1234"; // 모든 테스트 계정 공통

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // ---- 계정 6개 + 가입대기 샘플 1개 ----
  const accounts = [
    // 발주 받는 업자 4
    {
      username: "seobu",
      role: "VENDOR_SEOBU",
      storeName: "서부일광 청과",
      phone: "051-000-0001",
      address: "부산 엄궁 농산물도매시장 청과동",
    },
    {
      username: "jangheung",
      role: "VENDOR_JANGHEUNG",
      storeName: "조은팜",
      phone: "051-000-0002",
      address: "부산 엄궁 농산물도매시장 채소동",
    },
    {
      username: "chaeumchae",
      role: "VENDOR_CHAEUMCHAE",
      storeName: "채움채",
      phone: "051-000-0003",
      address: "부산 엄궁 농산물도매시장",
    },
    {
      username: "saerop",
      role: "ADMIN_SAEROP",
      storeName: "새롭",
      phone: "051-000-0000",
      address: "부산 핫딜마켓 본사",
    },
    // 테스트 지점 2
    {
      username: "hotdeal",
      role: "MERCHANT_HOTDEAL",
      storeName: "핫딜마켓 사상점",
      phone: "010-1111-2222",
      address: "부산 사상구 OO로 12",
    },
    {
      username: "sample",
      role: "MERCHANT_SEOBU",
      storeName: "사하청과",
      phone: "010-3333-4444",
      address: "부산 사하구 OO로 34",
    },
  ];

  for (const a of accounts) {
    await prisma.user.upsert({
      where: { username: a.username },
      update: {
        role: a.role,
        status: "APPROVED",
        storeName: a.storeName,
        phone: a.phone,
        address: a.address,
      },
      create: {
        username: a.username,
        passwordHash,
        role: a.role,
        status: "APPROVED",
        storeName: a.storeName,
        phone: a.phone,
        address: a.address,
      },
    });
  }

  // (창고관리 전용 admin/1234 계정 제거됨 — 창고관리는 새롭 관리자 계정 + 비밀번호 게이트로 이관)

  // 가입 승인 흐름 테스트용 대기 신청자
  await prisma.user.upsert({
    where: { username: "waiting" },
    update: {},
    create: {
      username: "waiting",
      passwordHash,
      role: "APPLICANT",
      status: "PENDING",
      storeName: "새내기상회",
      phone: "010-9999-0000",
      address: "부산 북구 OO로 56",
    },
  });

  // 재고현황은 새롭(본사)이 실제로 입력 — 데모 데이터 시드하지 않음

  // ---- 샘플 발주(서부일광 inbox 확인용) ----
  const hotdeal = await prisma.user.findUnique({ where: { username: "hotdeal" } });
  const sample = await prisma.user.findUnique({ where: { username: "sample" } });
  const hasOrders = (await prisma.order.count()) > 0;

  if (!hasOrders && hotdeal) {
    await prisma.order.create({
      data: {
        userId: hotdeal.id,
        category: "FRUIT",
        vendorRole: "VENDOR_SEOBU",
        rawText: "샤인 4다이전반 / 부사특자 3다이 단거로",
        aiSummary: "과일 발주 2건",
        aiProcessed: true,
        aiEngine: "rule",
        items: {
          create: [
            {
              sortOrder: 0,
              rawName: "샤인",
              rawQty: "4다이전반",
              rawNote: "",
              name: "샤인머스캣",
              qty: "4다이(전반)",
              note: "",
            },
            {
              sortOrder: 1,
              rawName: "부사특자",
              rawQty: "3다이",
              rawNote: "단거로",
              name: "부사 사과 (특)",
              qty: "3다이",
              note: "당도 높은 상품으로 요청",
            },
          ],
        },
      },
    });
  }

  if (!hasOrders && sample) {
    await prisma.order.create({
      data: {
        userId: sample.id,
        category: "FRUIT",
        vendorRole: "VENDOR_SEOBU",
        pickupTime: "오전 7시",
        rawText: "참외 2다이, 수박 1통",
        aiSummary: "과일 발주 2건",
        aiProcessed: true,
        aiEngine: "rule",
        items: {
          create: [
            { sortOrder: 0, rawName: "참외", rawQty: "2다이", rawNote: "", name: "참외", qty: "2다이", note: "" },
            { sortOrder: 1, rawName: "수박", rawQty: "1통", rawNote: "", name: "수박", qty: "1통", note: "" },
          ],
        },
      },
    });
  }

  // ---- 가맹 오픈 온보딩(퀘스트) 마스터 체크리스트 — 없을 때만 생성(관리자 편집분 보존) ----
  if ((await prisma.onboardingStep.count()) === 0) {
    const steps = [
      {
        order: 1,
        actor: "BOTH",
        title: "가맹계약 절차",
        body: "정보공개서·가맹계약서 교부(계약 예정일 최소 15일 전, 이메일 또는 서면) 후 15일 경과 시 가맹계약 체결.",
      },
      {
        order: 2,
        actor: "MERCHANT",
        title: "사업자등록 및 인허가",
        body: "임대차계약 + 개인사업자 등록(간이과세·소매업, 종목: 청과/야채/수산물/건어물/떡). 추가 인허가: 통신판매업 신고, 식품 영업신고(위생교육 이수).",
      },
      {
        order: 3,
        actor: "BOTH",
        title: "인테리어 및 시설 구축",
        body: "인테리어 약 1주 + 시설 설치·세팅 약 1주.",
      },
      {
        order: 4,
        actor: "BOTH",
        title: "POS 및 결제 시스템 구축",
        body: "지오아이앤씨: POS·카드단말기·키오스크·라벨프린터 설치, 카드승인 등록. 나우페이(Toss Payments) PG 승인 — 제출: 신분증·통신판매업 신고증(약 1~2주).",
      },
      {
        order: 5,
        actor: "BOTH",
        title: "점주 교육",
        body: "현장 교육 + 온라인 교육(1~3주). 운영 시스템·공동구매·상품 등록·고객응대(CS)·재고 및 발주관리·매출관리. 오픈 비품 구매(비품리스트 별도 제공).",
      },
      {
        order: 6,
        actor: "BOTH",
        title: "오픈 행사 운영",
        body: "오픈 행사 기획·전단지 배포·커뮤니티 공유 이벤트·사전 증정 이벤트·리뷰 이벤트.",
      },
      {
        order: 7,
        actor: "ADMIN",
        title: "정식 오픈 및 사후관리",
        body: "KPI 점검(일 매출·카카오톡방 유입 수·나우페이 주문 건수·방문 고객 수·구매 고객 수·객단가). 담당 슈퍼바이저가 오픈 후 운영 현황 점검·개선.",
      },
    ];
    for (const s of steps) await prisma.onboardingStep.create({ data: s });
    console.log("✅ 온보딩 단계 7개 시드 완료");
  }

  console.log("✅ Seed 완료 — 계정 비밀번호는 모두:", PASSWORD);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
