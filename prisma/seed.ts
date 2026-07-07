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

  console.log("✅ Seed 완료 — 계정 비밀번호는 모두:", PASSWORD);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
