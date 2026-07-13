import { prisma } from "@/lib/prisma";

// #25 관리자 홈 배지(가입대기·주간발주·핫딜마켓 발주)를 '마지막으로 본 시각 이후 새로 들어온 것'만
// 세도록, 화면별 '본 시각'을 AppMeta(key-value 타임스탬프)에 저장한다. 조직 단위(새롭) 공유로 충분.
export const ADMIN_SEEN_KEYS = {
  signup: "admin_seen_signup",
  weekly: "admin_seen_weekly",
  hotdeal: "admin_seen_hotdeal",
} as const;

export type AdminSeenSurface = keyof typeof ADMIN_SEEN_KEYS;

export async function getAdminSeen(
  surface: AdminSeenSurface,
): Promise<Date | null> {
  const row = await prisma.appMeta.findUnique({
    where: { key: ADMIN_SEEN_KEYS[surface] },
    select: { syncedAt: true },
  });
  return row?.syncedAt ?? null;
}

export async function markAdminSeen(surface: AdminSeenSurface): Promise<void> {
  const key = ADMIN_SEEN_KEYS[surface];
  const now = new Date();
  await prisma.appMeta.upsert({
    where: { key },
    create: { key, syncedAt: now },
    update: { syncedAt: now },
  });
}
