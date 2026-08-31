// ============================================================
//  BottomNav — 핫딜오더 코발트 하단 네비 (아이콘 + 활성 알약 + 배지)
//  위치: 기존 src/components/BottomNav.tsx 를 이 파일로 교체
//  스타일: handoff/globals-cobalt.css 의 .bottomnav 오버라이드 필요
//  로직(role 필터·활성 판정·myBadge)은 기존과 100% 동일합니다.
// ============================================================

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canOrderWeekly, type Role } from "@/lib/constants";

const ICONS = {
  weekly: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v3M16 3v3" />
      <path d="M8.5 13.5h3M8.5 16.5h5" />
    </svg>
  ),
  order: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <path d="M9 4V3a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 3v1" />
      <path d="M9 10.5h6" />
      <path d="M9 14.5h4" />
    </svg>
  ),
  reserve: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 3h11a1.5 1.5 0 0 1 1.5 1.5V21l-7-3.8L5 21V4.5A1.5 1.5 0 0 1 6.5 3Z" />
      <path d="M9.2 9.2l1.8 1.8 3.8-3.8" />
    </svg>
  ),
  inventory: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8.2 12 3.5 3 8.2v7.6l9 4.7 9-4.7V8.2Z" />
      <path d="M3 8.2l9 4.6 9-4.6" />
      <path d="M12 12.8v7.7" />
    </svg>
  ),
  my: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c1.4-3.2 3.9-4.8 7-4.8s5.6 1.6 7 4.8" />
    </svg>
  ),
};

export function BottomNav({
  role,
  myBadge = 0,
  weeklyBadge = 0,
}: {
  role: Role;
  myBadge?: number;
  weeklyBadge?: number;
}) {
  const path = usePathname();
  const items = [
    { href: "/order", label: "발주", icon: ICONS.order, badge: 0 },
    ...(canOrderWeekly(role)
      ? [{ href: "/weekly", label: "주간발주", icon: ICONS.weekly, badge: weeklyBadge }]
      : []),
    // 예약발주 — 핫딜마켓 가맹점만
    ...(role === "MERCHANT_HOTDEAL"
      ? [{ href: "/reservations", label: "예약발주", icon: ICONS.reserve, badge: 0 }]
      : []),
    // 재고현황 — 공구=예약발주 단일 소스 전환으로 하단 네비에서 숨김(담기 폐지).
    //   (페이지 자체는 열람 전용으로 남아 있고 직접 URL로는 접근 가능)
    { href: "/mypage", label: "마이", icon: ICONS.my, badge: myBadge },
  ];

  return (
    <nav className="bottomnav">
      {items.map((it) => {
        const active = path === it.href || path.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`bottomnav__item ${active ? "is-active" : ""}`}
          >
            <span className="bottomnav__ic">
              {it.icon}
              {/* 미수(입금요청)가 남아 있으면 '점(dot)'으로만 표시. 계산서가 결제돼도 ISSUED로 남아
                  건수는 무의미(누적 증가)하므로 숫자 대신 점으로 '미수 있음'만 알린다(2026-08-05~). */}
              {it.badge > 0 && (
                <span
                  className="bottomnav__badge"
                  style={{ width: 9, minWidth: 9, height: 9, padding: 0, borderRadius: 999 }}
                  aria-label="미수 있음"
                />
              )}
            </span>
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
