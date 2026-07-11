import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { weeklyPriceMap } from "@/lib/weekly";
import { WeeklyPriceForm } from "@/components/WeeklyPriceForm";

export default async function AdminWeeklyPricesPage() {
  await requireAdmin();
  const effective = await weeklyPriceMap();

  return (
    <>
      <Topbar brand="핫딜오더" title="주간발주 단가" />
      <div className="page">
        <h1 className="h1">주간발주 단가 관리</h1>
        <p className="lead">
          박스(발주 1단위)당 공급가예요. 여기서 바꾸면 이후 발주·입금요청서에 반영돼요.
          (이미 발주된 건은 그때 단가 그대로 유지)
        </p>
        <WeeklyPriceForm effective={effective} />
        <div style={{ marginTop: 20 }}>
          <Link href="/admin/weekly" className="btn btn--ghost btn--block">
            주간발주로 돌아가기
          </Link>
        </div>
      </div>
    </>
  );
}
