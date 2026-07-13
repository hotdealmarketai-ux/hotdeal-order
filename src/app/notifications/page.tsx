import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { homePathFor } from "@/lib/constants";
import { formatKStamp } from "@/lib/format";
import { Topbar } from "@/components/Topbar";
import { MarkAllRead } from "@/components/MarkAllRead";
import { NotificationList } from "@/components/NotificationList";

// 알림 목록 — 전역(모든 역할). 온 알림 표시, 스와이프 삭제/뒤로. #10
export default async function NotificationsPage() {
  const user = await requireUser();
  const home = homePathFor(user.role, user.status);

  const items = await prisma.notification.findMany({
    where: { userId: user.id },
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
