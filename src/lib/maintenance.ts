// 패치(유지보수) 모드 — ON이면 가맹점(점주) 화면 전체를 '업데이트 중' 안내로 잠근다.
// AppMeta presence 토글(orderLockOverride 와 동일 방식, 자동 만료 없음 — 관리자가 끌 때까지 유지).
// 관리자/업자(출고팀)/창고는 각자 별도 레이아웃이라 영향 없음(새벽 출고팀도 정상 조회).
import { prisma } from "@/lib/prisma";

const KEY = "maintenance_mode";

// 패치 모드 켜기 비밀번호(관리자 화면 잠금 + 서버 재검증 공용).
export const MAINTENANCE_PASSWORD = "1234";

export async function maintenanceOn(): Promise<boolean> {
  try {
    const m = await prisma.appMeta.findUnique({ where: { key: KEY } });
    return !!m;
  } catch {
    // DB 장애 시엔 잠그지 않는다(오탐으로 전체가 잠기는 것보다 정상 통과가 안전).
    return false;
  }
}

export async function setMaintenance(on: boolean): Promise<void> {
  if (on) {
    await prisma.appMeta.upsert({
      where: { key: KEY },
      create: { key: KEY },
      update: { syncedAt: new Date() },
    });
  } else {
    await prisma.appMeta.deleteMany({ where: { key: KEY } });
  }
}
