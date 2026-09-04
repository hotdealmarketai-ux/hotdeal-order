import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { listMerchantSessions } from "@/lib/user-session";
import { SessionsBoard } from "@/components/SessionsBoard";

export const dynamic = "force-dynamic";

// 가맹점 로그인 현황 — 아이디별로 현재 로그인된 기기(사람)를 실시간 표시 + 개별/전체 강제 로그아웃.
export default async function AdminSessionsPage() {
  await requireAdmin();
  const groups = await listMerchantSessions();
  return (
    <>
      <Topbar backHref="/admin" title="로그인 현황" />
      <div className="page">
        <p className="hint" style={{ marginBottom: 12 }}>
          가맹점 아이디별로 지금 로그인돼 있는 기기와 접속 상태를 보여줘요. 한 아이디를 여러 명이 각자
          폰에서 쓰고 있으면 전부 나오고, 특정 기기 1개만 골라 강제 로그아웃할 수 있어요.
        </p>
        <SessionsBoard initial={groups} />
      </div>
    </>
  );
}
