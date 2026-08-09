import { prisma } from "@/lib/prisma";

// tick 디스패처 하트비트 기반 크론 생존 점검.
// tick 라우트가 매분 호출될 때마다 AppMeta "tick:heartbeat"를 갱신 → 오래되면(멈춤) 관리자에게 경고.
// (외부 크론이 조용히 죽어도 관리자 홈에서 즉시 보이게 하는 데드맨 스위치.)
const STALE_MIN = 15; // 1분 주기라 15분 이상 안 돌면 확실히 중단. 일시적 지연 오탐 방지 여유.

export async function getCronHealth(): Promise<{
  ok: boolean;
  lastBeat: Date | null;
  staleMinutes: number | null;
}> {
  try {
    const m = await prisma.appMeta.findUnique({ where: { key: "tick:heartbeat" } });
    if (!m?.syncedAt) return { ok: false, lastBeat: null, staleMinutes: null }; // 아직 한 번도 안 뜀 = 멈춤
    const staleMinutes = Math.floor((Date.now() - m.syncedAt.getTime()) / 60000);
    return { ok: staleMinutes < STALE_MIN, lastBeat: m.syncedAt, staleMinutes };
  } catch {
    return { ok: true, lastBeat: null, staleMinutes: null }; // DB 오류 시엔 오탐 방지(경고 억제)
  }
}
