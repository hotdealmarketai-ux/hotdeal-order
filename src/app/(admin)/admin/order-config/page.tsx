import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { orderChannelConfig, fixedItemsByCat } from "@/lib/order-flags";
import { prisma } from "@/lib/prisma";
import { OrderConfigBoard } from "@/components/OrderConfigBoard";

export const dynamic = "force-dynamic";

export default async function OrderConfigPage() {
  await requireAdmin();
  const [config, all] = await Promise.all([
    orderChannelConfig(),
    prisma.fixedOrderItem.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, active: true, category: true },
    }),
  ]);
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
        <OrderConfigBoard
          config={config}
          fruitItems={fruitItems}
          vegItems={vegItems}
        />
      </div>
    </>
  );
}
