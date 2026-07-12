"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteNotificationAction } from "@/app/actions/notification";

export type NotifItem = {
  id: string;
  title: string;
  body: string;
  url: string | null;
  unread: boolean;
  when: string;
};

// 알림 목록 — 왼쪽 스와이프로 삭제, 오른쪽 스와이프로 뒤로(홈), 탭하면 해당 화면 이동. #10
export function NotificationList({
  items,
  homeHref,
}: {
  items: NotifItem[];
  homeHref: string;
}) {
  const router = useRouter();
  const [list, setList] = useState(items);

  // 페이지 오른쪽 스와이프 → 뒤로(메인)
  const pageStart = useRef<{ x: number; y: number } | null>(null);
  function onPageTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    pageStart.current = { x: t.clientX, y: t.clientY };
  }
  function onPageTouchEnd(e: React.TouchEvent) {
    const s = pageStart.current;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (dx > 90 && Math.abs(dy) < 60) router.push(homeHref);
    pageStart.current = null;
  }

  if (list.length === 0) {
    return (
      <div className="empty">
        <p>알림이 없어요.</p>
      </div>
    );
  }

  return (
    <div onTouchStart={onPageTouchStart} onTouchEnd={onPageTouchEnd}>
      {list.map((n) => (
        <NotifRow
          key={n.id}
          n={n}
          onOpen={() => {
            if (n.url) router.push(n.url);
          }}
          onDelete={() => {
            setList((l) => l.filter((x) => x.id !== n.id));
            deleteNotificationAction(n.id).catch(() => {});
          }}
        />
      ))}
    </div>
  );
}

function NotifRow({
  n,
  onOpen,
  onDelete,
}: {
  n: NotifItem;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  return (
    <div className="notif">
      <button type="button" className="notif__del" onClick={onDelete} aria-label="삭제">
        삭제
      </button>
      <div
        className={`notif__body ${n.unread ? "is-unread" : ""}`}
        style={{ transform: `translateX(${dx}px)` }}
        onTouchStart={(e) => {
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          moved.current = false;
        }}
        onTouchMove={(e) => {
          const s = start.current;
          if (!s) return;
          const mx = e.touches[0].clientX - s.x;
          const my = e.touches[0].clientY - s.y;
          if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
            moved.current = true;
            setDx(Math.min(0, Math.max(-84, mx)));
          }
        }}
        onTouchEnd={() => {
          setDx((d) => (d < -42 ? -76 : 0));
          start.current = null;
        }}
        onClick={() => {
          if (!moved.current) onOpen();
        }}
      >
        <div className="notif__title">{n.title}</div>
        {n.body ? <div className="notif__sub">{n.body}</div> : null}
        <div className="notif__when">{n.when}</div>
        {n.unread ? <span className="notif__dot" aria-hidden /> : null}
      </div>
    </div>
  );
}
