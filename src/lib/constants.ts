// ============================================================
//  도메인 상수 — 역할 / 발주 카테고리 / 업자 매핑
// ============================================================

export type Role =
  | "APPLICANT" // 가입신청 후 승인 대기(역할 미배정)
  | "MERCHANT_HOTDEAL" // 핫딜마켓 가맹점주
  | "MERCHANT_SEOBU" // 서부일광 타 소매업자
  | "VENDOR_SEOBU" // 서부일광 (과일)
  | "VENDOR_JANGHEUNG" // 장흥 (야채)
  | "VENDOR_CHAEUMCHAE" // 채움채 (두부류)
  | "ADMIN_SAEROP"; // 새롭 (본사·관리자·공구)

export type Status = "PENDING" | "APPROVED" | "REJECTED";

export type Category = "FRUIT" | "VEG" | "TOOL" | "TOFU";

// 발주 카테고리 정의
export interface CategoryDef {
  key: Category;
  label: string; // 화면 표기
  vendorLabel: string; // 받는 업자 이름
  vendorRole: Role; // 목적지 업자 role
  icon: string; // 이모지(어르신 직관성)
  desc: string;
}

export const CATEGORIES: Record<Category, CategoryDef> = {
  FRUIT: {
    key: "FRUIT",
    label: "과일",
    vendorLabel: "서부일광",
    vendorRole: "VENDOR_SEOBU",
    icon: "🍎",
    desc: "청과 (서부일광)",
  },
  VEG: {
    key: "VEG",
    label: "야채",
    vendorLabel: "장흥",
    vendorRole: "VENDOR_JANGHEUNG",
    icon: "🥬",
    desc: "채소 (장흥)",
  },
  TOOL: {
    key: "TOOL",
    label: "공구",
    vendorLabel: "새롭",
    vendorRole: "ADMIN_SAEROP",
    icon: "🛒",
    desc: "공동구매 (새롭 본사)",
  },
  TOFU: {
    key: "TOFU",
    label: "두부·콩나물",
    vendorLabel: "채움채",
    vendorRole: "VENDOR_CHAEUMCHAE",
    icon: "🫛",
    desc: "두부·콩나물·순두부·숙주 (채움채)",
  },
};

export const CATEGORY_ORDER: Category[] = ["FRUIT", "VEG", "TOOL", "TOFU"];

// 역할별로 발주 가능한 카테고리
export const ALLOWED_CATEGORIES: Partial<Record<Role, Category[]>> = {
  MERCHANT_HOTDEAL: ["FRUIT", "VEG", "TOOL", "TOFU"],
  MERCHANT_SEOBU: ["FRUIT"],
};

// 업자 role -> 표기
export const VENDOR_LABEL: Partial<Record<Role, string>> = {
  VENDOR_SEOBU: "서부일광",
  VENDOR_JANGHEUNG: "장흥",
  VENDOR_CHAEUMCHAE: "채움채",
  ADMIN_SAEROP: "새롭",
};

// role -> 사람이 읽는 이름
export const ROLE_LABEL: Record<Role, string> = {
  APPLICANT: "가입 대기",
  MERCHANT_HOTDEAL: "핫딜마켓 가맹점",
  MERCHANT_SEOBU: "서부일광 소매",
  VENDOR_SEOBU: "서부일광",
  VENDOR_JANGHEUNG: "장흥",
  VENDOR_CHAEUMCHAE: "채움채",
  ADMIN_SAEROP: "새롭 (본사)",
};

// 관리자가 가입 승인 시 배정 가능한 점주 타입
export const ASSIGNABLE_MERCHANT_ROLES: Role[] = [
  "MERCHANT_HOTDEAL",
  "MERCHANT_SEOBU",
];

export function isMerchant(role: Role): boolean {
  return role === "MERCHANT_HOTDEAL" || role === "MERCHANT_SEOBU";
}

export function isVendor(role: Role): boolean {
  return (
    role === "VENDOR_SEOBU" ||
    role === "VENDOR_JANGHEUNG" ||
    role === "VENDOR_CHAEUMCHAE" ||
    role === "ADMIN_SAEROP"
  );
}

export function isAdmin(role: Role): boolean {
  return role === "ADMIN_SAEROP";
}

// 서부일광 소매업자만 픽업시간 입력
export function needsPickupTime(role: Role): boolean {
  return role === "MERCHANT_SEOBU";
}

// 핫딜마켓 가맹점만 재고현황 열람 + 하단 네비
export function canViewInventory(role: Role): boolean {
  return role === "MERCHANT_HOTDEAL";
}

export function allowedCategoriesFor(role: Role): Category[] {
  return ALLOWED_CATEGORIES[role] ?? [];
}

export function vendorRoleForCategory(category: Category): Role {
  return CATEGORIES[category].vendorRole;
}

// 로그인 후 역할별 홈 경로
export function homePathFor(role: Role, status: Status): string {
  if (status !== "APPROVED") return "/pending";
  if (role === "ADMIN_SAEROP") return "/admin";
  if (isVendor(role)) return "/vendor";
  if (isMerchant(role)) return "/order";
  return "/pending";
}
