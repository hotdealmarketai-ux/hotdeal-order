import { requireMerchant } from "@/lib/session";
import { allowedCategoriesFor, needsPickupTime } from "@/lib/constants";
import { OrderForm } from "@/components/OrderForm";

export default async function OrderPage() {
  const user = await requireMerchant();
  return (
    <>
      <header className="topbar">
        <div className="brandmark">핫딜마켓</div>
        <div className="topbar__spacer" />
        <span className="chip">{user.storeName}</span>
      </header>
      <div className="page">
        <h1 className="h1">발주하기</h1>
        <p className="lead">필요한 품목을 적고 발주하기를 누르면 정리해 드려요.</p>
        <OrderForm
          categories={allowedCategoriesFor(user.role)}
          needsPickup={needsPickupTime(user.role)}
        />
      </div>
    </>
  );
}
