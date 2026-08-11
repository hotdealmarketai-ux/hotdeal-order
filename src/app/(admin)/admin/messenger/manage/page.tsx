import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { MessengerManage } from "@/components/MessengerManage";

export const dynamic = "force-dynamic";

// 사내 메신저 관리 — 멤버(2차 로그인 계정) 추가/비번변경/활성토글, 채널 추가/보관. 1차 관리자면 접근 가능.
export default async function MessengerManagePage() {
  await requireAdmin();
  const [members, channels] = await Promise.all([
    prisma.messengerMember.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }], select: { id: true, name: true, active: true } }),
    prisma.messengerChannel.findMany({ orderBy: [{ archived: "asc" }, { sortOrder: "asc" }], select: { id: true, name: true, archived: true } }),
  ]);

  return (
    <>
      <Topbar backHref="/admin/messenger" title="메신저 관리" />
      <div className="page">
        <MessengerManage members={members} channels={channels} />
      </div>
    </>
  );
}
