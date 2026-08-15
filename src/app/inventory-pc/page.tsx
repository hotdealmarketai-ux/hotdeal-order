import Link from "next/link";
import { headers, cookies } from "next/headers";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isMobileUA } from "@/lib/warehouse-auth";
import { INVPC_UNLOCK_COOKIE } from "@/lib/inventory-pc-auth";
import { unlockInventoryPcAction } from "@/app/actions/inventory-pc";
import { reservationConfirmedByItem } from "@/lib/reservation-stock";
import { addInventoryAction } from "@/app/actions/admin";
import { InventoryEditor } from "@/components/InventoryEditor";
import { InventoryBulkImport } from "@/components/InventoryBulkImport";
import { SheetImportButton } from "@/components/SheetImportButton";
import { SheetSyncDiagnose } from "@/components/SheetSyncDiagnose";
import { CategoryAutoAssign } from "@/components/CategoryAutoAssign";
import { InventoryBackupControl } from "@/components/InventoryBackupControl";
import { Collapsible } from "@/components/Collapsible";
import { SubmitButton } from "@/components/SubmitButton";
import { InboundManager } from "@/components/InboundManager";
import { toInboundRow } from "@/lib/inbound";
import { WeeklyProductForm } from "@/components/WeeklyProductForm";
import { getWeeklyProducts } from "@/lib/weekly";
import { ChaeumchaeProductForm } from "@/components/ChaeumchaeProductForm";
import { getChaeumchaeProducts } from "@/lib/chaeumchae-products";
import { computeOrderShipmentDiff } from "@/lib/order-shipment-diff";
import { OrderShipmentDiffView } from "@/components/OrderShipmentDiffView";
import { normalizeDateStr } from "@/lib/date";
import { listFlatProductsAdmin } from "@/lib/reservation-flat";
import { getInventoryPickList } from "@/lib/reservation-data";
import { FlatReservationAdmin } from "@/components/FlatReservationAdmin";

export const dynamic = "force-dynamic";

// PC 전용 통합 관리(ERP) — 재고현황·입고·재고마감·주간상품·예약상품·채움채상품을 한 화면 탭으로.
// 창고관리(/warehouse)와 동일 게이트(관리자 + 비번 + 모바일 차단). 상품/재고 편집기는 기존 컴포넌트 재사용.
type TabKey =
  | "inventory"
  | "inbound"
  | "chaeumchae"
  | "weekly"
  | "closing"
  | "reservation";

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: "inventory", label: "재고 현황", hint: "품목·수량·공급가·과세" },
  { key: "inbound", label: "입고", hint: "입고 기록·재고 반영" },
  { key: "chaeumchae", label: "채움채 상품", hint: "박스입수·낱개단가" },
  { key: "weekly", label: "주간 상품", hint: "가격·과세" },
  { key: "closing", label: "재고 마감", hint: "발주↔출고 대조" },
  { key: "reservation", label: "예약 상품", hint: "예약일자별 등록" },
];

export default async function InventoryPcPage(props: {
  searchParams: Promise<{ pw?: string; tab?: string; date?: string }>;
}) {
  await requireAdmin();
  const { pw, tab: tabRaw, date: dateRaw } = await props.searchParams;

  // PC 전용 — 모바일 접속이면 안내만.
  const ua = (await headers()).get("user-agent") ?? "";
  if (isMobileUA(ua)) return <InvPcMobileBlock />;

  // 비밀번호 게이트.
  const unlocked = (await cookies()).get(INVPC_UNLOCK_COOKIE)?.value === "1";
  if (!unlocked) return <InvPcUnlock wrong={pw === "bad"} />;

  const tab: TabKey =
    (TABS.find((t) => t.key === tabRaw)?.key as TabKey) ?? "inventory";

  return (
    <div className="invpc__inner">
      <header className="invpc__top">
        <div>
          <div className="invpc__title">
            통합 관리 <span>· PC</span>
          </div>
          <div className="invpc__sub">
            재고·입고·마감·주간·예약·채움채를 한곳에서. 입력하면 저장됩니다.
          </div>
        </div>
        <div className="invpc__topbtns">
          <Link href="/admin" className="btn btn--ghost btn--sm invpc__link">← 관리자 홈</Link>
        </div>
      </header>

      {/* ERP 탭 — 딱딱 나누어진 섹션 전환 */}
      <nav className="erptabs">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/inventory-pc?tab=${t.key}`}
            className={`erptab ${tab === t.key ? "is-active" : ""}`}
          >
            <span className="erptab__label">{t.label}</span>
            <span className="erptab__hint">{t.hint}</span>
          </Link>
        ))}
      </nav>

      <div className="erppane">
        {tab === "inventory" && <InventoryTab />}
        {tab === "inbound" && <InboundTab />}
        {tab === "chaeumchae" && <ChaeumchaeTab />}
        {tab === "weekly" && <WeeklyTab />}
        {tab === "closing" && <ClosingTab date={normalizeDateStr(dateRaw)} />}
        {tab === "reservation" && <ReservationTab />}
      </div>
    </div>
  );
}

// ── 재고 현황 ──
async function InventoryTab() {
  const items = await prisma.inventoryItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const reservedByItem = await reservationConfirmedByItem();
  const idsKey = items.map((i) => i.id).join(",");
  const totalQty = items.reduce((s, it) => s + (it.qty || 0), 0);
  return (
    <>
      <div className="erphead">
        <div className="erphead__title">재고 현황</div>
        <div className="erphead__meta">
          {items.length}종 · 총 {totalQty.toLocaleString()}개
        </div>
      </div>
      <Collapsible title="기능" hint="백업 · 카테고리 자동분류 · 구글시트 · 엑셀 붙여넣기">
        <div className="invpc__tools">
          <InventoryBackupControl />
          <CategoryAutoAssign />
          <SheetSyncDiagnose />
          <SheetImportButton />
          <InventoryBulkImport currentNames={items.map((it) => it.name)} />
        </div>
      </Collapsible>
      <div className="card">
        <div className="section-label" style={{ margin: "0 0 10px" }}>새 품목 추가</div>
        <form action={addInventoryAction} className="invpc__addrow">
          <input name="name" className="input input--compact" placeholder="품목명" required style={{ flex: 2, minWidth: 160 }} />
          <input name="qty" className="input input--compact" inputMode="numeric" placeholder="남은 수량" style={{ flex: 1, minWidth: 90 }} />
          <input name="supplyPrice" className="input input--compact" inputMode="numeric" placeholder="공급가(원)" style={{ flex: 1, minWidth: 100 }} />
          <input name="expiry" className="input input--compact" placeholder="유통기한 (예: 26-07-27, 없으면 비움)" style={{ flex: 1.6, minWidth: 180 }} />
          <button className="btn btn--primary btn--sm" style={{ whiteSpace: "nowrap" }}>추가하기</button>
        </form>
      </div>
      <div className="section-label">등록된 재고</div>
      <InventoryEditor
        key={idsKey}
        initial={items.map((it) => ({
          id: it.id,
          name: it.name,
          qty: it.qty ? String(it.qty) : "",
          supplyPrice: it.supplyPrice ? String(it.supplyPrice) : "",
          expiry: it.expiry ?? "",
          majorCat: it.majorCat ?? "",
          minorCat: it.minorCat ?? "",
          tax: it.tax ?? "",
          reserved: reservedByItem[it.id] ?? 0,
        }))}
      />
    </>
  );
}

// ── 입고 ──
async function InboundTab() {
  const [logs, catRows] = await Promise.all([
    prisma.inboundLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.inventoryItem.findMany({
      where: { deletedAt: null, majorCat: { not: "" } },
      select: { majorCat: true, minorCat: true },
      distinct: ["majorCat", "minorCat"],
      orderBy: [{ majorCat: "asc" }, { minorCat: "asc" }],
    }),
  ]);
  const treeMap = new Map<string, string[]>();
  for (const r of catRows) {
    if (!r.majorCat) continue;
    const minors = treeMap.get(r.majorCat) ?? [];
    if (r.minorCat && !minors.includes(r.minorCat)) minors.push(r.minorCat);
    treeMap.set(r.majorCat, minors);
  }
  const catTree = [...treeMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ko"))
    .map(([major, minors]) => ({ major, minors: minors.sort((a, b) => a.localeCompare(b, "ko")) }));
  return (
    <>
      <div className="erphead">
        <div className="erphead__title">입고</div>
        <div className="erphead__meta">품목·수량·공급가·유통기한 입력 → 재고 가산</div>
      </div>
      <InboundManager initialRows={logs.map(toInboundRow)} catTree={catTree} />
    </>
  );
}

// ── 채움채 상품 ──
async function ChaeumchaeTab() {
  const products = await getChaeumchaeProducts();
  return (
    <>
      <div className="erphead">
        <div className="erphead__title">채움채 상품</div>
        <div className="erphead__meta">박스입수·낱개단가·과세 — 계산서에 낱개로 자동 환산</div>
      </div>
      <ChaeumchaeProductForm initial={products} />
    </>
  );
}

// ── 주간 상품 ──
async function WeeklyTab() {
  const products = await getWeeklyProducts();
  return (
    <>
      <div className="erphead">
        <div className="erphead__title">주간발주 상품</div>
        <div className="erphead__meta">카테고리별 가격·과세</div>
      </div>
      <WeeklyProductForm initial={products} />
    </>
  );
}

// ── 재고 마감(발주↔출고 대조) — PC 인라인 ──
async function ClosingTab({ date }: { date: string }) {
  const data = await computeOrderShipmentDiff(date);
  return (
    <>
      <div className="erphead">
        <div className="erphead__title">재고 마감</div>
        <div className="erphead__meta">본사출고 발주 vs 발행 계산서 대조 — 튄 품목만 표시(재고 차감 없음)</div>
      </div>
      {/* 출고일 선택 — 같은 탭 유지(tab=closing) */}
      <form method="get" className="erpbar">
        <input type="hidden" name="tab" value="closing" />
        <span className="row__sub">출고일</span>
        <input
          className="input input--compact"
          type="date"
          name="date"
          defaultValue={date}
          style={{ width: "auto" }}
        />
        <button className="btn btn--soft btn--sm" type="submit">보기</button>
      </form>
      <OrderShipmentDiffView data={data} />
    </>
  );
}

// ── 예약발주 상품 — PC 인라인(등록 + 단일 목록) ──
async function ReservationTab() {
  const [products, inventoryItems] = await Promise.all([
    listFlatProductsAdmin("open"),
    getInventoryPickList(),
  ]);
  const rows = products.map((p) => ({
    id: p.id,
    name: p.name,
    pickupDate: p.pickupDate,
    supplyPrice: p.supplyPrice,
    inventoryItemId: p.inventoryItemId,
    closeAtMs: p.closeAt.getTime(),
    closeAtLocal: new Date(p.closeAt.getTime() + 9 * 3600 * 1000)
      .toISOString()
      .slice(0, 16),
    stockFixed: p.stockFixed,
    totalQty: p.totalQty,
    storeCount: p.storeCount,
  }));

  return (
    <>
      <div className="erphead">
        <div className="erphead__title">예약발주 상품</div>
        <div className="erphead__meta">
          진행 중 {rows.length}종 · 상품별 마감(시분초) 등록, 마감 임박순
        </div>
      </div>

      {/* 다른 예약 뷰로 이동(집계·지난 발주·지난 마감) */}
      <div className="erpcards" style={{ marginBottom: 14 }}>
        <Link href="/admin/reservations/summary?scope=open" className="erpcard">
          <div className="erpcard__t">전체 집계 보기</div>
          <div className="erpcard__d">진행 중 예약 상품·지점 수량 집계.</div>
        </Link>
        <Link href="/admin/reservations/past" className="erpcard">
          <div className="erpcard__t">지난 예약발주</div>
          <div className="erpcard__d">픽업 지난 예약발주 열람.</div>
        </Link>
        <Link href="/admin/reservations/closed" className="erpcard">
          <div className="erpcard__t">지난 예약 마감</div>
          <div className="erpcard__d">마감된 예약 상품 열람.</div>
        </Link>
      </div>

      {/* 등록(상품별 마감 시분초) + 진행 중 목록 — 한 컴포넌트에서. 모바일 /admin/reservations와 동일 기능. */}
      <FlatReservationAdmin products={rows} inventoryItems={inventoryItems} />
    </>
  );
}

// PC 전용 — 모바일이면 안내.
function InvPcMobileBlock() {
  return (
    <div className="invpc__gate">
      <div style={{ fontSize: 40 }}>🖥️</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>PC로 접속해주세요</div>
      <div style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        통합 관리는 데스크톱(컴퓨터)에서만 이용할 수 있어요.
      </div>
      <a href="/admin" className="btn btn--ghost" style={{ marginTop: 10, textDecoration: "none" }}>
        ← 관리자 홈으로
      </a>
    </div>
  );
}

// 비밀번호 게이트.
function InvPcUnlock({ wrong }: { wrong: boolean }) {
  return (
    <div className="invpc__gate">
      <form action={unlockInventoryPcAction} className="invpc__gateform">
        <div style={{ fontSize: 34 }}>📦</div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>PC 통합 관리</div>
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
        {wrong && <div style={{ color: "var(--danger)", fontSize: 13 }}>비밀번호가 올바르지 않습니다.</div>}
        <SubmitButton className="btn btn--primary btn--block" pendingText="확인 중…">입력</SubmitButton>
        <a href="/admin" className="btn btn--ghost btn--block" style={{ textDecoration: "none" }}>
          ← 관리자 홈으로
        </a>
      </form>
    </div>
  );
}
