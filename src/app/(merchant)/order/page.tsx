import { requireMerchant } from "@/lib/session";
import { allowedCategoriesFor, needsPickupTime } from "@/lib/constants";
import {
  hasOrderWindow,
  isOrderOpen,
  ORDER_OPEN_HOUR,
  ORDER_CLOSE_HOUR,
  ORDER_DEADLINE_LABEL,
} from "@/lib/deadline";
import { OrderForm } from "@/components/OrderForm";
import { DeadlineCountdown } from "@/components/DeadlineCountdown";

export default async function OrderPage() {
  const user = await requireMerchant();
  const windowed = hasOrderWindow(user.role);
  const locked = windowed && !isOrderOpen();

  return (
    <>
      <header className="topbar">
        <div className="brandmark">오더야</div>
        <div className="topbar__spacer" />
        <span className="chip">{user.storeName}</span>
      </header>
      <div className="page">
        {windowed && (
          <DeadlineCountdown
            openHour={ORDER_OPEN_HOUR}
            closeHour={ORDER_CLOSE_HOUR}
            deadlineLabel={ORDER_DEADLINE_LABEL}
          />
        )}

        <h1 className="h1">발주하기</h1>

        <OrderForm
          categories={allowedCategoriesFor(user.role)}
          needsPickup={needsPickupTime(user.role)}
          locked={locked}
        />
      </div>
    </>
  );
}
