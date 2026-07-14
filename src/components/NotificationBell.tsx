import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// 상단 알림 종 — 미읽음 개수 배지(인스타 DM식). 클릭 시 /notifications. 비로그인 시 미표시.
export async function NotificationBell() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return null;
  const count = await prisma.notification
    .count({ where: { userId: user.id, readAt: null, type: { not: "chat" } } })
    .catch(() => 0);
  return (
    <Link href="/notifications" className="tbar__bell" aria-label="알림">
      {/* 인스타식 하트 — 알림 '설정'(종)과 구분되는 알림 '목록' 버튼 */}
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 21s-8-4.65-8-10.5C4 6.9 6.4 5 8.6 5c1.5 0 2.8.75 3.4 2 .6-1.25 1.9-2 3.4-2C17.6 5 20 6.9 20 10.5 20 16.35 12 21 12 21Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
      {count > 0 && (
        <span className="badge-count">{count > 99 ? "+99" : count}</span>
      )}
    </Link>
  );
}
