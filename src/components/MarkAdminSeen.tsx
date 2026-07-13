"use client";

import { useEffect, useRef } from "react";
import { markAdminSeenAction } from "@/app/actions/admin-seen";
import type { AdminSeenSurface } from "@/lib/admin-seen";

// #25 관리자 화면 진입 시 한 번 '본 시각'을 서버에 기록(홈 배지 소멸). 렌더링은 없음.
export function MarkAdminSeen({ surface }: { surface: AdminSeenSurface }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    markAdminSeenAction(surface).catch(() => {});
  }, [surface]);
  return null;
}
