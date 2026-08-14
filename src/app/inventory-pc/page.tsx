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

export const dynamic = "force-dynamic";

// PC 전용 재고관리 — 창고관리(/warehouse)와 동일 구조(관리자 + 비번 게이트 + 모바일 차단).
// 재고 페이지(/admin/inventory)의 기능(인라인 편집·자동저장·카테고리·백업·시트·엑셀·예약구분)을
// InventoryEditor 등 기존 컴포넌트를 그대로 재사용해 넓은 데스크톱 화면으로 제공한다.
export default async function InventoryPcPage(props: {
  searchParams: Promise<{ pw?: string }>;
}) {
  await requireAdmin();
  const { pw } = await props.searchParams;

  // PC 전용 — 모바일 접속이면 안내만 하고 막는다.
  const ua = (await headers()).get("user-agent") ?? "";
  if (isMobileUA(ua)) return <InvPcMobileBlock />;

  // 비밀번호 게이트 — 관리자 로그인 + invpc_unlock 쿠키가 있어야 입장.
  const unlocked = (await cookies()).get(INVPC_UNLOCK_COOKIE)?.value === "1";
  if (!unlocked) return <InvPcUnlock wrong={pw === "bad"} />;

  const items = await prisma.inventoryItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  // 실재고(base) vs 예약 확정 수량(품목별) — 편집기에서 '예약 N개 잡힘' 표시.
  const reservedByItem = await reservationConfirmedByItem();
  const idsKey = items.map((i) => i.id).join(",");
  const totalQty = items.reduce((s, it) => s + (it.qty || 0), 0);

  return (
    <div className="invpc__inner">
      <header className="invpc__top">
        <div>
          <div className="invpc__title">
            재고관리 <span>· PC</span>
          </div>
          <div className="invpc__sub">
            품목 {items.length}종 · 총 수량 {totalQty.toLocaleString()}개 · 입력하면 자동 저장됩니다
          </div>
        </div>
        <div className="invpc__topbtns">
          <Link href="/admin/inbound" className="btn btn--soft btn--sm invpc__link">입고</Link>
          <Link href="/admin/inventory" className="btn btn--ghost btn--sm invpc__link">← 재고 페이지</Link>
        </div>
      </header>

      {/* 잘 안 쓰는 기능(백업·카테고리·시트·엑셀)은 토글로 접어 둔다(기본 닫힘) */}
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
    </div>
  );
}

// PC 전용 — 모바일이면 안내.
function InvPcMobileBlock() {
  return (
    <div className="invpc__gate">
      <div style={{ fontSize: 40 }}>🖥️</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>PC로 접속해주세요</div>
      <div style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        PC 재고관리는 데스크톱(컴퓨터)에서만 이용할 수 있어요.
      </div>
      <a href="/admin/inventory" className="btn btn--ghost" style={{ marginTop: 10, textDecoration: "none" }}>
        ← 재고 페이지로
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
        <div style={{ fontSize: 18, fontWeight: 800 }}>PC 재고관리</div>
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
        <a href="/admin/inventory" className="btn btn--ghost btn--block" style={{ textDecoration: "none" }}>
          ← 재고 페이지로
        </a>
      </form>
    </div>
  );
}
