import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getMessengerMember } from "@/lib/messenger-session";
import { messengerLogoutAction } from "@/app/actions/messenger";
import { MessengerLogin } from "@/components/MessengerLogin";
import { MessengerApp } from "@/components/MessengerApp";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

// 사내 메신저 — 1차(공용 관리자) 진입 후 2차(개인) 로그인. 로그인 안 됐으면 멤버 선택+PIN, 됐으면 채널 메신저.
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
      <>
        <Topbar backHref="/admin" title="사내 메신저" />
        <div className="page">
          {members.length === 0 ? (
            <div className="empty" style={{ marginTop: 20 }}>
              <p>아직 등록된 멤버가 없어요.</p>
              <Link href="/admin/messenger/manage" className="btn btn--soft" style={{ marginTop: 12 }}>
                멤버 등록하러 가기
              </Link>
            </div>
          ) : (
            <>
              <MessengerLogin members={members} />
              <div style={{ marginTop: 18, textAlign: "center" }}>
                <Link href="/admin/messenger/manage" className="row__sub" style={{ textDecoration: "underline" }}>
                  멤버·채널 관리
                </Link>
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  const channels = await prisma.messengerChannel.findMany({
    where: { archived: false },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  return (
    <>
      <Topbar backHref="/admin" title="사내 메신저" />
      <div className="page">
        <div className="spread" style={{ marginBottom: 12, alignItems: "center" }}>
          <span className="row__sub">
            나: <b style={{ color: "var(--fg)" }}>{me.name}</b>
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/messenger/manage" className="btn btn--xs btn--soft">
              관리
            </Link>
            <form action={messengerLogoutAction}>
              <SubmitButton className="btn btn--xs btn--ghost" pendingText="…">
                로그아웃
              </SubmitButton>
            </form>
          </div>
        </div>
        <MessengerApp me={me} channels={channels} />
      </div>
    </>
  );
}
