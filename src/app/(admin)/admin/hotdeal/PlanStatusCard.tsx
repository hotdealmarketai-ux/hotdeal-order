import Link from "next/link";
import { dowOf, labelDate, shipmentDayOf } from "@/lib/date";
import { prevWindowKey } from "@/lib/schedule";
import { getDayPlan, planStatsForDate, PLAN_CATS, type PlanCat } from "@/lib/order-plan";
import { logError } from "@/lib/log";

// '이 출고일 편성 현황' — 핫딜마켓 발주 목록 맨 위(품목 제한 모드 편성이 있는 날만).
// 출고일 → 발주창 키: 월요일 출고 = 토요일 창(토·일 발주), 그 외 = 전날, 일요일 출고 없음.
// 숫자는 관리자 편성 화면과 같은 planStatsForDate(같은 숫자 같은 계산).

const CAT_LABEL: Record<PlanCat, string> = { FRUIT: "과일", VEG: "야채", TOOL: "공구" };

/** 출고일 → 그 출고일에 실리는 발주창 키(없으면 null). */
export function windowKeyForShipment(shipmentDate: string): string | null {
  if (dowOf(shipmentDate) === 0) return null; // 일요일은 출고 없음
  const key = prevWindowKey(shipmentDate);
  return shipmentDayOf(key) === shipmentDate ? key : null;
}

type CatStat = {
  cat: PlanCat;
  count: number; // 보이는 품목 수(숨김 제외)
  hidden: number;
  total: number; // 전 지점 발주 합계
  stock: number; // 재고수량 합(정해진 품목만)
  unlimited: number; // 재고수량을 안 정한(무제한) 품목 수
  closed: number; // 마감(남은 0) 품목 수
  over: number; // 재고수량보다 많이 들어간 품목 수(관리자 대리 수정 초과 등)
};

export async function PlanStatusCard({ shipmentDate }: { shipmentDate: string }) {
  const key = windowKeyForShipment(shipmentDate);
  if (!key) return null;

  let cats: CatStat[] = [];
  let tofu: { exists: boolean; hidden: number } = { exists: false, hidden: 0 };
  try {
    const plan = await getDayPlan(key);
    const anyPlan = PLAN_CATS.some((c) => plan.cats[c].exists) || plan.tofu.exists;
    if (!anyPlan) return null; // 편성이 없으면 카드 없음(지금 화면 그대로)
    const stats = await planStatsForDate(key);
    tofu = { exists: plan.tofu.exists, hidden: plan.tofu.hiddenSeqs.length };
    cats = PLAN_CATS.filter((c) => plan.cats[c].exists).map((c) => {
      const s: CatStat = { cat: c, count: 0, hidden: 0, total: 0, stock: 0, unlimited: 0, closed: 0, over: 0 };
      for (const it of plan.cats[c].items) {
        const st = stats.get(it.id);
        const total = st?.total ?? 0;
        s.total += total;
        if (it.hidden) {
          s.hidden += 1;
          continue;
        }
        s.count += 1;
        if (it.stockQty === null) s.unlimited += 1;
        else {
          s.stock += it.stockQty;
          if (total > it.stockQty) s.over += 1;
        }
        if (st && st.remaining !== null && st.remaining <= 0) s.closed += 1;
      }
      return s;
    });
  } catch (err) {
    // 편성 표가 없거나 잠깐 오류여도 발주 목록은 그대로 보여야 한다.
    logError("hotdeal.planCard", err, { shipmentDate, key });
    return null;
  }

  const n = (v: number) => v.toLocaleString("ko-KR");

  return (
    <div className="card" style={{ marginBottom: 12, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div className="pushcard__title">이 출고일 편성 현황</div>
          <div className="pushcard__sub">
            {labelDate(key)} 발주창{dowOf(key) === 6 ? "(토·일)" : ""} → {labelDate(shipmentDate)} 출고
          </div>
        </div>
        <Link href={`/admin/order-plan/${key}`} className="btn btn--sm">
          편성 보기
        </Link>
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        {cats.map((s) => (
          <div
            key={s.cat}
            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 13 }}
          >
            <b style={{ minWidth: 36 }}>{CAT_LABEL[s.cat]}</b>
            <span className="row__sub" style={{ margin: 0 }}>
              품목 {n(s.count)}개{s.hidden > 0 ? `(숨김 ${n(s.hidden)})` : ""} · 발주 {n(s.total)}
              {s.count - s.unlimited > 0 ? ` / 재고 ${n(s.stock)}` : ""}
              {s.unlimited > 0 && s.count - s.unlimited > 0 ? ` · 무제한 ${n(s.unlimited)}개` : ""}
            </span>
            {s.closed > 0 && <span className="badge badge--danger">마감 {n(s.closed)}</span>}
            {s.over > 0 && <span className="badge badge--req">초과 {n(s.over)}</span>}
          </div>
        ))}
        {tofu.exists && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <b style={{ minWidth: 36 }}>채움채</b>
            <span className="row__sub" style={{ margin: 0 }}>
              {tofu.hidden > 0 ? `숨김 ${n(tofu.hidden)}개` : "전부 노출"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
