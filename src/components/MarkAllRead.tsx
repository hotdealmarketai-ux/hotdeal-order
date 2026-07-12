"use client";

import { useEffect } from "react";
import { markAllNotificationsReadAction } from "@/app/actions/notification";

// 알림목록 진입 시 1회 전부 읽음 처리(인스타식 — 열면 배지 소멸). 렌더 없음.
export function MarkAllRead() {
  useEffect(() => {
    markAllNotificationsReadAction().catch(() => {});
  }, []);
  return null;
}
