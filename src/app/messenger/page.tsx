import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMessengerMember } from "@/lib/messenger-session";
import { MessengerLogin } from "@/components/MessengerLogin";
import { MessengerWorkspace } from "@/components/MessengerWorkspace";

export const dynamic = "force-dynamic";

// 1차(공용 새롭 관리자) 진입 후 2차(개인) 로그인. 로그인 전=게이트 카드, 후=워크스페이스.
export default async function MessengerPage() {
  await requireAdmin();
  const me = await getMessengerMember();

  if (!me) {
    const members = await prisma.messengerMember.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    });
    return (
      <div className="mw-gate">
        <div className="mw-gate__card">
          <div className="mw-gate__brand">
            <span className="mw-gate__logo">핫</span>
            <div>
              <div className="mw-gate__title">핫딜마켓 메신저</div>
            </div>
          </div>
          {members.length === 0 ? (
            <div className="mw-gate__empty">
              <p>아직 등록된 멤버가 없어요.</p>
              <Link href="/messenger/manage" className="btn btn--soft">멤버 등록하러 가기</Link>
            </div>
          ) : (
            <MessengerLogin members={members} />
          )}
          <div className="mw-gate__foot">
            <Link href="/messenger/manage" className="mw-gate__link">멤버·채널 관리</Link>
            <Link href="/admin" className="mw-gate__link">← 핫딜오더로 돌아가기</Link>
          </div>
        </div>
      </div>
    );
  }

  const [channels, members, groups] = await Promise.all([
    prisma.messengerChannel.findMany({
      where: { archived: false },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, favorite: true, groupId: true },
    }),
    prisma.messengerMember.findMany({
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, active: true },
    }),
    prisma.messengerChannelGroup.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return <MessengerWorkspace me={me} channels={channels} members={members} groups={groups} />;
}
