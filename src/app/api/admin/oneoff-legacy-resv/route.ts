// ⚠ 1회성 운영 엔드포인트 — 레거시(구조 개편 전) 예약발주에 '지점 추가'가 UI로 안 되는 건을
//   수기로 한 번만 처리하기 위한 임시 라우트. CRON_SECRET 보호. 사용 후 즉시 제거(다음 배포에서 삭제).
//   mode=inspect: 읽기 전용(배치·상품·점포·기존주문 확인). mode=commit: 지정 id로 예약주문/품목 1건 upsert.
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // 관리자 세션 가드 — 로그인한 관리자(ADMIN_SAEROP)만. 비밀키 불필요(라이브는 관리자 세션 경로로).
  const me = await getCurrentUser();
  if (!me || !isAdmin(me.role)) {
    return Response.json({ ok: false, error: "관리자 로그인 필요" }, { status: 403 });
  }

  const mode = url.searchParams.get("mode") ?? "inspect";
  const reserveDate = url.searchParams.get("reserveDate") ?? "";
  const productQ = url.searchParams.get("product") ?? "";
  const storeQ = url.searchParams.get("store") ?? "";

  // ── INSPECT: 아무것도 쓰지 않고 현재 상태만 반환 ──
  if (mode === "inspect") {
    const batches = await prisma.reservationBatch.findMany({
      where: { reserveDate: reserveDate || undefined },
      select: {
        id: true, reserveDate: true, pickupDate: true, active: true,
        _count: { select: { products: true, orders: true } },
      },
      orderBy: { reserveDate: "desc" },
      take: 10,
    });
    const batchIds = batches.map((b) => b.id);
    const products = await prisma.reservationProduct.findMany({
      where: {
        batchId: { in: batchIds },
        ...(productQ ? { name: { contains: productQ } } : {}),
      },
      select: {
        id: true, batchId: true, name: true, supplyPrice: true,
        pickupDate: true, inventoryItemId: true, active: true, sortOrder: true,
      },
      orderBy: { sortOrder: "asc" },
    });
    const stores = storeQ
      ? await prisma.user.findMany({
          where: { storeName: { contains: storeQ } },
          select: { id: true, username: true, storeName: true, role: true },
          take: 20,
        })
      : [];
    // 매칭 점포들의 이 배치 기존 주문(있으면)
    const storeIds = stores.map((s) => s.id);
    const existingOrders = await prisma.reservationOrder.findMany({
      where: { batchId: { in: batchIds }, userId: { in: storeIds } },
      select: {
        id: true, batchId: true, userId: true, confirmed: true, confirmedAt: true,
        items: {
          select: { productId: true, name: true, qty: true, pickupDate: true,
            confirmedAt: true, stockDeductedAt: true, supplyPrice: true, inventoryItemId: true },
        },
      },
    });
    // 같은 배치의 다른 주문 몇 건 — confirmed/pickupDate/stockDeducted 패턴 참고용
    const siblingSample = await prisma.reservationOrder.findMany({
      where: { batchId: { in: batchIds } },
      select: {
        userId: true, confirmed: true,
        user: { select: { storeName: true } },
        items: { select: { name: true, qty: true, pickupDate: true, confirmedAt: true, stockDeductedAt: true } },
      },
      take: 4,
      orderBy: { createdAt: "asc" },
    });
    return Response.json({ ok: true, mode, reserveDate, batches, products, stores, existingOrders, siblingSample });
  }

  // ── COMMIT: inspect로 확인한 정확한 id로만 1건 upsert ──
  if (mode === "commit") {
    const batchId = url.searchParams.get("batchId") ?? "";
    const productId = url.searchParams.get("productId") ?? "";
    const userId = url.searchParams.get("userId") ?? "";
    const qty = parseInt(url.searchParams.get("qty") ?? "", 10);
    const confirmTok = url.searchParams.get("confirm") ?? "";
    if (confirmTok !== "ADD-ONE") return Response.json({ ok: false, error: "confirm token 필요(confirm=ADD-ONE)" }, { status: 400 });
    if (!batchId || !productId || !userId || !Number.isFinite(qty) || qty <= 0)
      return Response.json({ ok: false, error: "batchId·productId·userId·qty(>0) 필수" }, { status: 400 });

    const [batch, product, user] = await Promise.all([
      prisma.reservationBatch.findUnique({ where: { id: batchId }, select: { id: true, pickupDate: true } }),
      prisma.reservationProduct.findUnique({
        where: { id: productId },
        select: { id: true, batchId: true, name: true, supplyPrice: true, pickupDate: true, inventoryItemId: true, sortOrder: true },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, storeName: true } }),
    ]);
    if (!batch) return Response.json({ ok: false, error: "batch 없음" }, { status: 404 });
    if (!product || product.batchId !== batchId)
      return Response.json({ ok: false, error: "product 없음/배치 불일치" }, { status: 404 });
    if (!user) return Response.json({ ok: false, error: "user 없음" }, { status: 404 });

    const before = await prisma.reservationOrder.findUnique({
      where: { userId_batchId: { userId, batchId } },
      select: { id: true, confirmed: true, items: { select: { productId: true, qty: true } } },
    });

    const now = new Date();
    const pickupSnap = product.pickupDate || batch.pickupDate || "";
    const result = await prisma.$transaction(async (tx) => {
      // 주문(점주×배치) upsert — 없으면 확정 상태로 생성(레거시 공구 게이트=order.confirmed).
      const order = await tx.reservationOrder.upsert({
        where: { userId_batchId: { userId, batchId } },
        create: { batchId, userId, confirmed: true, confirmedAt: now },
        update: { confirmed: true, confirmedAt: now },
        select: { id: true },
      });
      // 품목(주문×상품) upsert — 스냅샷은 상품에서 복사, 확정시각도 채워 신·구 게이트 모두 통과.
      await tx.reservationOrderItem.upsert({
        where: { orderId_productId: { orderId: order.id, productId } },
        create: {
          orderId: order.id, productId, sortOrder: product.sortOrder,
          name: product.name, supplyPrice: product.supplyPrice, pickupDate: pickupSnap,
          inventoryItemId: product.inventoryItemId, qty, confirmedAt: now,
        },
        update: { qty, confirmedAt: now, name: product.name, supplyPrice: product.supplyPrice, pickupDate: pickupSnap },
        select: { orderId: true },
      });
      return order.id;
    });

    const after = await prisma.reservationOrder.findUnique({
      where: { id: result },
      select: {
        id: true, confirmed: true, confirmedAt: true,
        user: { select: { storeName: true } },
        items: { select: { name: true, qty: true, pickupDate: true, supplyPrice: true, inventoryItemId: true, confirmedAt: true } },
      },
    });
    return Response.json({ ok: true, mode, product: product.name, store: user.storeName, pickupSnap, before, after });
  }

  return Response.json({ ok: false, error: "mode는 inspect | commit" }, { status: 400 });
}
