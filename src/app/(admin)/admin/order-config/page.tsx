import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { orderChannelConfig, fixedItemsByCat } from "@/lib/order-flags";
import { prisma } from "@/lib/prisma";
import { OrderConfigBoard } from "@/components/OrderConfigBoard";
import { OrderPlanModeCard } from "@/components/OrderPlanModeCard";
import { getRestrictConfig } from "@/lib/restrict-mode";
import { modeCardInfo } from "../order-plan/_lib/plan-data";
import "../order-plan/order-plan.css";

export const dynamic = "force-dynamic";

export default async function OrderConfigPage() {
  await requireAdmin();
  const [config, all, restrictCfg] = await Promise.all([
    orderChannelConfig(),
    prisma.fixedOrderItem.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, active: true, category: true },
    }),
    getRestrictConfig(),
  ]);
  const restrictInfo = modeCardInfo(restrictCfg);
  const fruitItems = all
    .filter((i) => i.category === "FRUIT")
    .map((i) => ({ id: i.id, name: i.name, active: i.active }));
  const vegItems = all
    .filter((i) => i.category === "VEG")
    .map((i) => ({ id: i.id, name: i.name, active: i.active }));

  return (
    <>
      <Topbar backHref="/admin" title="일반 발주 관리" />
      <div className="page">
        {/* 품목 제한 모드 스위치 — 편성 달력과 같은 카드 */}
        <div style={{ marginBottom: 14 }}>
          <OrderPlanModeCard info={restrictInfo} showLink />
        </div>
        <OrderConfigBoard
          config={config}
          fruitItems={fruitItems}
          vegItems={vegItems}
          restrict={{ on: restrictCfg.on, allStores: restrictCfg.pilot.length === 0, active: restrictInfo.active }}
        />
      </div>
    </>
  );
}
