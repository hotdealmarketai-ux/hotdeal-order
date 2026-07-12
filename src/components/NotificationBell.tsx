import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// 상단 알림 종 — 미읽음 개수 배지(인스타 DM식). 클릭 시 /notifications. 비로그인 시 미표시.
export async function NotificationBell() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return null;
  const count = await prisma.notification
    .count({ where: { userId: user.id, readAt: null } })
    .catch(() => 0);
  return (
    <Link href="/notifications" className="tbar__bell" aria-label="알림">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 3a6 6 0 0 0-6 6v3.5L4.6 15a1 1 0 0 0 .87 1.5h13.06a1 1 0 0 0 .87-1.5L18 12.5V9a6 6 0 0 0-6-6Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="M9.5 19a2.5 2.5 0 0 0 5 0"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
      {count > 0 && (
        <span className="tbar__bell-badge">{count > 99 ? "99+" : count}</span>
      )}
    </Link>
  );
}
