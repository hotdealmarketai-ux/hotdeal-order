import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getDayPlan, prevPlannedDate } from "@/lib/order-plan";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";
import { isWindowKey, nextWindowKey, normalizeWindowKey, prevWindowKey, windowKeyAt } from "@/lib/schedule";
import { dowOf, labelDate, shipmentDayOf } from "@/lib/date";
import { OrderPlanEditor, type EditorPlan } from "@/components/OrderPlanEditor";
import {
  inventoryPickList,
  itemStatsForDate,
  tofuBoxesForWindow,
  upcomingKeys,
  windowStatuses,
} from "../_lib/plan-data";
import { ALL_CATS, ITEM_CATS, type AnyCat } from "../_lib/types";
import "../order-plan.css";

export const dynamic = "force-dynamic";

// 발주 품목 편성 — 날짜(발주창) 하나 편집. 지난 창은 읽기 전용, 오늘·지난 창은 품목별 발주 현황.
export default async function OrderPlanDatePage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  await requireAdmin();
  const { date: raw } = await params;
  const { c } = await searchParams;
  const norm = normalizeWindowKey(raw);
  if (norm !== raw && isWindowKey(norm)) redirect(`/admin/order-plan/${norm}`);
  if (!isWindowKey(raw)) redirect("/admin/order-plan");
  const date = raw;

  const cur = windowKeyAt();
  const readOnly = date < cur;
  const showStats = date <= cur;

  const [plan, stats, inv, tofuBoxes, ...prevDates] = await Promise.all([
    getDayPlan(date),
    showStats ? itemStatsForDate(date) : Promise.resolve({}),
    readOnly ? Promise.resolve([]) : inventoryPickList(date),
    showStats ? tofuBoxesForWindow(date) : Promise.resolve({} as Record<string, number>),
    ...ALL_CATS.map((k) => prevPlannedDate(date, k)),
  ]);

  // '여러 날에 적용' 후보 — 오늘 다음 발주창부터 12개(이 날짜 제외)
  const targets = upcomingKeys(13, nextWindowKey(cur)).filter((k) => k !== date).slice(0, 12);
  const srcDates = prevDates.filter((d): d is string => !!d);
  const st = await windowStatuses([...srcDates, ...targets]);

  const prevSources = {} as Record<AnyCat, { date: string; label: string; count: number } | null>;
  ALL_CATS.forEach((k, i) => {
    const d = prevDates[i];
    if (!d) {
      prevSources[k] = null;
      return;
    }
    const s = st[d];
    const count = k === "TOFU" ? s.tofu.visible : s.cats[k].count;
    prevSources[k] = { date: d, label: labelDate(d), count };
  });

  const editorPlan: EditorPlan = {
    FRUIT: { exists: false, updatedAt: null, items: [] },
    VEG: { exists: false, updatedAt: null, items: [] },
    TOOL: { exists: false, updatedAt: null, items: [] },
    TOFU: { exists: plan.tofu.exists, updatedAt: plan.tofu.updatedAt?.toISOString() ?? null, hiddenSeqs: plan.tofu.hiddenSeqs },
  };
  for (const k of ITEM_CATS) {
    const p = plan.cats[k];
    editorPlan[k] = {
      exists: p.exists,
      updatedAt: p.updatedAt?.toISOString() ?? null,
      items: p.items.map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        stockQty: i.stockQty,
        maxPerStore: i.maxPerStore,
        minPerStore: i.minPerStore,
        inventoryItemId: i.inventoryItemId,
        supplyPrice: i.supplyPrice,
        tax: i.tax,
        hidden: i.hidden,
      })),
    };
  }

  const copyTargets = targets.map((k) => ({
    key: k,
    label: labelDate(k),
    planned: {
      FRUIT: st[k].cats.FRUIT.state !== "none",
      VEG: st[k].cats.VEG.state !== "none",
      TOOL: st[k].cats.TOOL.state !== "none",
      TOFU: st[k].tofu.exists,
    } as Record<AnyCat, boolean>,
  }));

  const stamp = ALL_CATS.map((k) => editorPlan[k].updatedAt ?? "-").join("|");
  const initialTab: AnyCat = c === "VEG" || c === "TOOL" || c === "TOFU" ? c : "FRUIT";
  const prevKey = prevWindowKey(date);
  const nextKey = nextWindowKey(date);

  return (
    <>
      <Topbar backHref="/admin/order-plan" title="편성 편집" />
      <div className="page oplan oplan--edit">
        <OrderPlanEditor
          date={date}
          label={labelDate(date)}
          shipLabel={dowOf(date) === 6 ? "토·일 발주 → 월 출고" : `→ ${labelDate(shipmentDayOf(date))} 출고`}
          isToday={date === cur}
          readOnly={readOnly}
          showStats={showStats}
          prevKey={prevKey}
          nextKey={nextKey}
          monthHref={`/admin/order-plan?m=${date.slice(0, 7)}`}
          plan={editorPlan}
          stats={stats}
          prevSources={prevSources}
          inv={inv}
          tofuCatalog={CHAEUMCHAE_CATALOG}
          tofuBoxes={tofuBoxes}
          copyTargets={copyTargets}
          initialTab={initialTab}
          stamp={stamp}
        />
      </div>
    </>
  );
}
