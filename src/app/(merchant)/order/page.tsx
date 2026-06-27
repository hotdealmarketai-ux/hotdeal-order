import Link from "next/link";
import { requireMerchant } from "@/lib/session";
import { allowedCategoriesFor, needsPickupTime } from "@/lib/constants";
import {
  hasOrderDeadline,
  isPastOrderDeadline,
  ORDER_DEADLINE_HOUR,
  ORDER_DEADLINE_LABEL,
} from "@/lib/deadline";
import { OrderForm } from "@/components/OrderForm";
import { DeadlineCountdown } from "@/components/DeadlineCountdown";

export default async function OrderPage() {
  const user = await requireMerchant();
  const deadline = hasOrderDeadline(user.role);
  const closed = deadline && isPastOrderDeadline();

  return (
    <>
      <header className="topbar">
        <div className="brandmark">핫딜마켓</div>
        <div className="topbar__spacer" />
        <span className="chip">{user.storeName}</span>
      </header>
      <div className="page">
        {deadline && (
          <DeadlineCountdown
            deadlineHour={ORDER_DEADLINE_HOUR}
            deadlineLabel={ORDER_DEADLINE_LABEL}
          />
        )}

        {closed ? (
          <>
            <h1 className="h1">발주 마감</h1>
            <div className="notice notice--error" style={{ marginTop: 8 }}>
              오늘 발주 시간이 마감되었어요. (매일 {ORDER_DEADLINE_LABEL} 마감)
              <br />
              내일 다시 발주해 주세요.
            </div>
            <div style={{ marginTop: 18 }}>
              <Link href="/mypage" className="btn btn--ghost">
                지난 발주 보기
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="h1">발주하기</h1>
            <p className="lead">필요한 품목을 적고 발주하기를 누르면 정리해 드려요.</p>
            <OrderForm
              categories={allowedCategoriesFor(user.role)}
              needsPickup={needsPickupTime(user.role)}
            />
          </>
        )}
      </div>
    </>
  );
}
