"use client";

import { useRouter, usePathname } from "next/navigation";

// 홈/루트 화면(하단 네비로 진입)에선 숨기고, 나머지 전역 페이지엔 '이전 페이지로' 뒤로가기. #4
const ROOTS = new Set([
  "/order",
  "/weekly",
  "/inventory",
  "/mypage",
  "/admin",
  "/vendor",
  "/pending",
  "/login",
  "/signup",
]);

export function BackButton() {
  const router = useRouter();
  const path = usePathname();
  if (ROOTS.has(path)) return null;
  return (
    <button
      type="button"
      className="tbar__back"
      aria-label="뒤로"
      onClick={() => router.back()}
    >
      ‹
    </button>
  );
}
