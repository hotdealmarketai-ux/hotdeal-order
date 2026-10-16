import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTS,
  TOUCH_THROTTLE_MS,
  createUserSession,
  readSessionRow,
  touchSession,
} from "@/lib/user-session";
import { prisma } from "@/lib/prisma";
import { getRestrictConfig, restrictAppliesTo, modeStamp } from "@/lib/restrict-mode";
import { windowKeyAt } from "@/lib/schedule";

// 로그인한 기기의 하트비트 — hd_sid 쿠키로 세션 레코드를 관리한다(라우트 핸들러라 쿠키 설정 가능).
// - 쿠키 없음/유령: 이 사용자로 세션 생성 + 쿠키 설정
// - 유효: lastSeenAt 갱신(실시간 접속)
// - revoked(강제/정상 로그아웃): ok:false → 클라가 /login 으로
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

// 이 지점의 모드 표식(품목 제한 모드 여부 + 발주창 키). 클라가 직전 값과 다르면 router.refresh() 로
// 이미 열린 앱의 하단 탭·화면을 새로 맞춘다(Next 16 레이아웃은 화면 이동 때 다시 그리지 않음).
// 모드가 꺼져 있으면 지점 조회 없이 바로 'F:키'. 읽기 실패면 표식 없이(클라는 비교하지 않음).
async function modeOf(uid: string, now: number): Promise<string | undefined> {
  try {
    const cfg = await getRestrictConfig();
    const key = windowKeyAt(now);
    if (!cfg.on) return modeStamp(false, key);
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, role: true } });
    return modeStamp(restrictAppliesTo(cfg, u, now), key);
  } catch {
    return undefined;
  }
}

export async function POST() {
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return NextResponse.json({ ok: false }, NO_STORE);

  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value ?? "";

  if (sid) {
    const row = await readSessionRow(sid);
    if (row && row.userId === uid) {
      if (row.revokedAt) return NextResponse.json({ ok: false }, NO_STORE);
      if (Date.now() - row.lastSeenAt.getTime() > TOUCH_THROTTLE_MS) await touchSession(sid);
      return NextResponse.json({ ok: true, mode: await modeOf(uid, Date.now()) }, NO_STORE);
    }
    // row 없음(삭제) 또는 다른 계정 쿠키(공용기기) → 이 사용자로 새로 생성
  }

  const newSid = await createUserSession(uid);
  const res = NextResponse.json({ ok: true, mode: await modeOf(uid, Date.now()) }, NO_STORE);
  if (newSid) res.cookies.set(SESSION_COOKIE, newSid, SESSION_COOKIE_OPTS);
  return res;
}
