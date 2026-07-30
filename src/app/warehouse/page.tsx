import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { headers, cookies } from "next/headers";
import { kstToday, orderRangeForShipment } from "@/lib/date";
import { heldByItem } from "@/lib/stock-hold";
import { reservationHeldByItem } from "@/lib/reservation-stock";
import { windowKeyAt } from "@/lib/schedule";
import { WarehouseBoard } from "@/components/warehouse/WarehouseBoard";
import type { BoxDTO } from "@/app/actions/warehouse";
import { unlockWarehouseAction } from "@/app/actions/warehouse";
import { WAREHOUSE_UNLOCK_COOKIE, isMobileUA } from "@/lib/warehouse-auth";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

const norm = (s: string) => s.replace(/\s/g, "");

// PC 창고관리 — 새롭 관리자 계정 전용 + 비밀번호(1234) 게이트, 모바일 차단. 위치별 평면도에 재고 품목을 박스로 배치.
export default async function WarehousePage(props: {
  searchParams: Promise<{ pw?: string }>;
}) {
  const user = await requireAdmin();
  const { pw } = await props.searchParams;

  // 창고관리는 PC 전용 — 모바일 접속이면 안내만 하고 막는다.
  const ua = (await headers()).get("user-agent") ?? "";
  if (isMobileUA(ua)) return <WarehouseMobileBlock />;

  // 비밀번호 게이트 — 관리자 로그인 + wh_unlock 쿠키가 있어야 입장.
  const unlocked =
    (await cookies()).get(WAREHOUSE_UNLOCK_COOKIE)?.value === "1";
  if (!unlocked) return <WarehouseUnlock wrong={pw === "bad"} />;

  // 재고현황 품목(읽기 전용) — 팔레트에서 박스로 추가할 원본. 유통기한(#9)도 실어 임박 하이라이트.
  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, qty: true, expiry: true },
  });
  const [held, resv] = await Promise.all([
    heldByItem(windowKeyAt()),
    reservationHeldByItem(),
  ]);

  // 창고 장소(동적) — 관리자가 추가/이름변경/삭제. 박스가 있는 장소는 삭제 못 하게 boxCount도 전달.
  const [locationRows, boxCountRows] = await Promise.all([
    prisma.warehouseLocation.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.warehouseBox.groupBy({ by: ["location"], _count: true }),
  ]);
  const boxCountByLoc = new Map(
    boxCountRows.map((r) => [r.location, r._count]),
  );
  const locations = locationRows.map((l) => ({
    id: l.id,
    name: l.name,
    boxCount: boxCountByLoc.get(l.id) ?? 0,
  }));
  const initialLocation = locations[0]?.id ?? "FLOOR1";

  // 지점 필터/발주수량 — '오늘 출고할 발주'를 지점별 재고 품목(itemId)+발주수량으로.
  const today = kstToday();
  const { start, end } = orderRangeForShipment(today);
  const invByNorm = new Map<string, string>();
  for (const it of items) {
    const k = norm(it.name);
    if (k && !invByNorm.has(k)) invByNorm.set(k, it.id);
  }
  const [toolOrders, resvItems] = await Promise.all([
    prisma.order.findMany({
      where: {
        category: "TOOL",
        status: { not: "CANCELLED" },
        createdAt: { gte: start, lt: end },
      },
      select: {
        user: { select: { storeName: true } },
        items: { select: { name: true, rawName: true, qty: true } },
      },
    }),
    prisma.reservationOrderItem.findMany({
      where: {
        pickupDate: today,
        inventoryItemId: { not: "" },
        qty: { gt: 0 },
        order: { batch: { active: true } },
      },
      select: {
        inventoryItemId: true,
        qty: true,
        order: { select: { user: { select: { storeName: true } } } },
      },
    }),
  ]);
  const parseQty = (s: string) => {
    const n = parseInt(String(s ?? "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const byStore = new Map<string, Map<string, number>>();
  const ensureStore = (s: string) => {
    let v = byStore.get(s);
    if (!v) {
      v = new Map();
      byStore.set(s, v);
    }
    return v;
  };
  for (const o of toolOrders)
    for (const it of o.items) {
      const id = invByNorm.get(norm(it.name || it.rawName || ""));
      if (!id) continue;
      const m = ensureStore(o.user.storeName);
      m.set(id, (m.get(id) ?? 0) + parseQty(it.qty));
    }
  for (const r of resvItems)
    if (r.inventoryItemId) {
      const m = ensureStore(r.order.user.storeName);
      m.set(r.inventoryItemId, (m.get(r.inventoryItemId) ?? 0) + r.qty);
    }

  const storeFilters = [...byStore.entries()]
    .filter(([, m]) => m.size > 0)
    .map(([storeName, m]) => ({
      storeName,
      items: [...m.entries()].map(([itemId, qty]) => ({ itemId, qty })),
    }))
    .sort((a, b) => a.storeName.localeCompare(b.storeName, "ko"));
  const todayCount = storeFilters.length;

  // 초기 장소 박스만 서버에서 로드 — 나머지는 탭 전환 시 클라이언트가 불러온다.
  const rows = await prisma.warehouseBox.findMany({
    where: { location: initialLocation },
    orderBy: { z: "asc" },
  });
  const initialBoxes: BoxDTO[] = rows.map((r) => ({
    id: r.id,
    location: r.location,
    itemId: r.itemId,
    label: r.label,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    color: r.color,
    z: r.z,
  }));

  return (
    <WarehouseBoard
      storeName={user.storeName}
      items={items.map((it) => ({
        id: it.id,
        name: it.name,
        qty: Math.max(0, it.qty - (held[it.id] ?? 0) - (resv[it.id] ?? 0)),
        expiry: it.expiry ?? "",
      }))}
      initialLocation={initialLocation}
      initialBoxes={initialBoxes}
      todayCount={todayCount}
      storeFilters={storeFilters}
      locations={locations}
    />
  );
}

// 모바일 접속 차단 안내
function WarehouseMobileBlock() {
  return (
    <div
      style={{
        minHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 40 }}>🖥️</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>PC로 접속해주세요</div>
      <div style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        창고관리는 PC(데스크톱)에서만 이용할 수 있어요.
      </div>
      <a
        href="/admin"
        className="btn btn--ghost"
        style={{ marginTop: 10, textDecoration: "none" }}
      >
        ← 홈으로 돌아가기
      </a>
    </div>
  );
}

// 비밀번호 입력 게이트
function WarehouseUnlock({ wrong }: { wrong: boolean }) {
  return (
    <div
      style={{
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <form
        action={unlockWarehouseAction}
        style={{
          width: "100%",
          maxWidth: 320,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 34 }}>📦</div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>창고관리</div>
        <div style={{ color: "var(--muted)" }}>비밀번호를 입력하세요.</div>
        <input
          className="input"
          type="password"
          name="password"
          inputMode="numeric"
          autoFocus
          placeholder="비밀번호"
          style={{ textAlign: "center", letterSpacing: 4 }}
        />
        {wrong && (
          <div style={{ color: "var(--danger)", fontSize: 13 }}>
            비밀번호가 올바르지 않습니다.
          </div>
        )}
        <SubmitButton className="btn btn--primary btn--block" pendingText="확인 중…">
          입력
        </SubmitButton>
        <a
          href="/admin"
          className="btn btn--ghost btn--block"
          style={{ textDecoration: "none" }}
        >
          ← 홈으로 돌아가기
        </a>
      </form>
    </div>
  );
}
