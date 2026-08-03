import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { homePathFor, isMerchant } from "@/lib/constants";
import { formatKStamp } from "@/lib/format";
import { maintenanceOn } from "@/lib/maintenance";
import { Topbar } from "@/components/Topbar";
import { MarkAllRead } from "@/components/MarkAllRead";
import { NotificationList } from "@/components/NotificationList";
import { MaintenanceGate } from "@/components/MaintenanceGate";

// 알림 목록 — 전역(모든 역할). 온 알림 표시, 스와이프 삭제/뒤로. #10
export default async function NotificationsPage() {
  const user = await requireUser();
  // 패치 모드 ON이면 가맹점은 이 페이지도 잠근다(직접 URL 접근 차단). 관리자·업자는 정상.
  if (isMerchant(user.role) && (await maintenanceOn())) {
    return (
      <div className="app">
        <MaintenanceGate />
      </div>
    );
  }
  const home = homePathFor(user.role, user.status);

  const items = await prisma.notification.findMany({
    where: { userId: user.id, type: { not: "chat" } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const data = items.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    url: n.url ?? null,
    unread: n.readAt == null,
    when: formatKStamp(n.createdAt),
  }));

  return (
    <>
      <Topbar backHref={home} title="알림" />
      <MarkAllRead />
      <div className="page">
        <NotificationList items={data} />
      </div>
    </>
  );
}
