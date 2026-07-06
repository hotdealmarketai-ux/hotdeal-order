import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatKDate } from "@/lib/format";
import { MemberEditForm } from "@/components/MemberEditForm";

export default async function AdminMemberDetail(props: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await props.params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: { _count: { select: { orders: true } } },
  });
  if (!user) notFound();

  return (
    <>
      <Topbar backHref="/admin/members" title="회원 정보" />
      <div className="page">
        <div className="card card--flat" style={{ marginBottom: 16 }}>
          <div className="kv">
            <span className="kv__k">아이디</span>
            <span className="kv__v">{user.username}</span>
          </div>
          <div className="kv">
            <span className="kv__k">가입일</span>
            <span className="kv__v">{formatKDate(user.createdAt)}</span>
          </div>
          <div className="kv">
            <span className="kv__k">발주 이력</span>
            <span className="kv__v">{user._count.orders}건</span>
          </div>
        </div>

        <MemberEditForm
          userId={user.id}
          isSelf={user.id === admin.id}
          initial={{
            storeName: user.storeName,
            phone: user.phone,
            address: user.address,
            role: user.role,
            status: user.status,
            payerNames: user.payerNames,
          }}
        />
      </div>
    </>
  );
}
