import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ROLE_LABEL, STATUS_LABEL, type Role, type Status } from "@/lib/constants";

function statusBadge(status: Status): string {
  if (status === "APPROVED") return "badge--ok";
  if (status === "SUSPENDED") return "badge--danger";
  if (status === "PENDING") return "badge--wait";
  return "badge--mute";
}

export default async function AdminMembers() {
  await requireAdmin();
  const members = await prisma.user.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return (
    <>
      <Topbar backHref="/admin" title="회원 관리" />
      <div className="page">
        <h1 className="h1">회원 관리</h1>
        <p className="lead">전체 {members.length}명</p>

        {members.length === 0 ? (
          <div className="empty">
            <p>회원이 없어요.</p>
          </div>
        ) : (
          <div className="list">
            {members.map((m) => (
              <Link href={`/admin/members/${m.id}`} className="row" key={m.id}>
                <div className="row__main">
                  <div className="row__title">{m.storeName}</div>
                  <div className="row__sub">
                    {m.username} · {ROLE_LABEL[m.role as Role]}
                  </div>
                </div>
                <span className={`badge ${statusBadge(m.status as Status)}`}>
                  {STATUS_LABEL[m.status as Status]}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
