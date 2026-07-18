// ============================================================
//  Topbar — 핫딜오더 코발트 공용 상단 헤더 (네이비 바)
//  위치 제안: src/components/Topbar.tsx
//  스타일: handoff/globals-cobalt.css 의 .tbar 클래스들이 필요합니다.
//
//  이 컴포넌트 하나로 전 페이지 상단을 시안처럼 통일합니다.
//  기존 <header className="topbar">...</header> 를 <Topbar .../> 로 교체하세요.
// ============================================================

import Link from "next/link";
import type { ReactNode } from "react";
import { NotificationBell } from "./NotificationBell";
import { PushToggle } from "./PushToggle";
import { BackButton } from "./BackButton";

export function Topbar({
  title,
  brand,
  backHref,
  right,
  children,
}: {
  /** 가운데 제목 (상세/관리 페이지) */
  title?: string;
  /** 왼쪽 큰 브랜드 워드마크 (예: "핫딜오더", "새롭 · 관리자") */
  brand?: string;
  /** 있으면 왼쪽에 뒤로가기(‹) 링크 */
  backHref?: string;
  /** 오른쪽 슬롯 (상호명 칩, 초기화 버튼 등) */
  right?: ReactNode;
  /** 네이비 바 "아래"에 들어갈 히어로 (예: 발주 마감 카운트다운) */
  children?: ReactNode;
}) {
  return (
    <header className="tbar">
      <div className="tbar__row">
        {/* #4 전역 뒤로가기(이전 페이지). 홈/루트에선 자동 숨김. backHref는 무시하고 router.back() 사용. */}
        <BackButton />
        {brand ? (
          // #3 로고/브랜드 클릭 → 메인(/ → 역할별 홈으로 리다이렉트)
          <Link href="/" className="tbar__brand" style={{ textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-white.png" alt="" width={34} height={34} />
            {brand}
          </Link>
        ) : null}
        {title ? <span className="tbar__title">{title}</span> : null}
        <span className="tbar__spacer" />
        {right}
        {/* 알림설정(푸시 켜기/끄기) — 전역(모든 역할·모든 페이지). 어느 페이지에서도 항상 노출 */}
        <PushToggle variant="header" />
        {/* 알림 종 — 전역(모든 역할). 미읽음 배지 + /notifications 진입. #8/#10 */}
        <NotificationBell />
      </div>
      {children ? <div className="tbar__hero">{children}</div> : null}
    </header>
  );
}

/** 헤더 오른쪽에 놓는 상호명/역할 칩 */
export function TopbarChip({ children }: { children: ReactNode }) {
  return <span className="tbar__chip">{children}</span>;
}

/* ------------------------------------------------------------
   사용 예시 (기존 페이지 교체 방법)

   1) 발주하기 (브랜드 + 상호명 칩 + 카운트다운 히어로)
   ------------------------------------------------------------
   import { Topbar, TopbarChip } from "@/components/Topbar";
   import { DeadlineCountdown } from "@/components/DeadlineCountdown";

   <Topbar brand="핫딜오더" right={<TopbarChip>{user.storeName}</TopbarChip>}>
     {windowed && <DeadlineCountdown deadlineLabel={ORDER_DEADLINE_LABEL} />}
   </Topbar>
   // ↑ .tbar__hero 스타일이 카운트다운을 자동으로 다크 버전으로 만들어 줍니다.

   2) 상세 페이지 (뒤로가기 + 제목)
   ------------------------------------------------------------
   <Topbar backHref="/order" title="발주서" />

   3) 관리자 발주 목록 (뒤로 + 제목 + 오른쪽 초기화 버튼)
   ------------------------------------------------------------
   <Topbar backHref="/admin" title="발주 목록" right={<ResetOrdersButton />} />

   4) 업자 inbox (제목 + 업자 칩)
   ------------------------------------------------------------
   <Topbar title="들어온 발주" right={<TopbarChip>서부일광</TopbarChip>} />
   ------------------------------------------------------------ */
