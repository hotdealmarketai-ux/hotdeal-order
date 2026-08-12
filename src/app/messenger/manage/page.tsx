import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { MessengerManage } from "@/components/MessengerManage";

export const dynamic = "force-dynamic";

// 멤버(2차 로그인 계정) 추가/비번변경/활성토글, 채널 추가/보관. 별도 셸의 관리 화면.
export default async function MessengerManagePage() {
  await requireAdmin();
  const [members, channels] = await Promise.all([
    prisma.messengerMember.findMany({
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, active: true },
    }),
    prisma.messengerChannel.findMany({
      orderBy: [{ archived: "asc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, archived: true },
    }),
  ]);

  return (
    <div className="mw-manage">
      <header className="mw-manage__top">
        <Link href="/messenger" className="mw-manage__back">← 메신저</Link>
        <div className="mw-manage__title">멤버 · 채널 관리</div>
      </header>
      <div className="mw-manage__body">
        <MessengerManage members={members} channels={channels} />
      </div>
    </div>
  );
}
