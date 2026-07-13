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

// 알림 목록 — 행 왼쪽 스와이프=삭제(오른쪽으로 되돌리면 그대로 유지), 탭=해당 화면 이동,
// 화면 왼쪽 가장자리에서 오른쪽 스와이프=이전 페이지로(iOS식). #11/#14
export function NotificationList({ items }: { items: NotifItem[] }) {
  const router = useRouter();
  const [list, setList] = useState(items); // 마운트 시 고정 → 읽음처리돼도 이번 화면 색 유지(#17)

  // 왼쪽 가장자리 시작 스와이프만 '뒤로'로 처리(행 스와이프와 충돌 방지).
  const edge = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    edge.current = t.clientX < 28 ? { x: t.clientX, y: t.clientY } : null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const s = edge.current;
    edge.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    if (t.clientX - s.x > 60 && Math.abs(t.clientY - s.y) < 60) router.back();
  }

  if (list.length === 0) {
    return (
      <div className="empty">
        <p>알림이 없어요.</p>
      </div>
    );
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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
  const start = useRef<{ x: number; y: number; dx: number } | null>(null);
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
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx };
          moved.current = false;
        }}
        onTouchMove={(e) => {
          const s = start.current;
          if (!s) return;
          const mx = e.touches[0].clientX - s.x;
          const my = e.touches[0].clientY - s.y;
          if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
            moved.current = true;
            setDx(Math.min(0, Math.max(-84, s.dx + mx)));
          }
        }}
        onTouchEnd={() => {
          setDx((d) => (d < -42 ? -76 : 0)); // 절반 넘으면 삭제버튼 노출, 아니면 원위치(되돌림)
          start.current = null;
        }}
        onClick={() => {
          if (moved.current) return; // 스와이프는 탭으로 취급 안 함
          if (dx < -4) {
            setDx(0); // 열려 있으면 탭=닫기
            return;
          }
          onOpen(); // 관련 화면으로 이동
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
