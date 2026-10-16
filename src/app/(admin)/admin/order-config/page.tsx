import { redirect } from "next/navigation";

// 옛 '일반 발주 관리' — 발주 시스템 관리(/admin/order-plan)로 합쳤다. 옛 주소·즐겨찾기는 그쪽으로 보낸다.
export default function OrderConfigPage() {
  redirect("/admin/order-plan");
}
