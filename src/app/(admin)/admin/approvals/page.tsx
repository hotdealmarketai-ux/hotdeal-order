import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { approveUserAction, rejectUserAction } from "@/app/actions/admin";
import { formatKDate } from "@/lib/format";

export default async function ApprovalsPage() {
  await requireAdmin();
  const pending = await prisma.user.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  return (
    <>
      <Topbar backHref="/admin" title="가입 승인" />
      <div className="page">
        <h1 className="h1">가입 승인</h1>
        <p className="lead">신청자를 승인하면서 발주 유형을 정해주세요.</p>

        {pending.length === 0 ? (
          <div className="empty">
            <p>대기 중인 가입 신청이 없어요.</p>
          </div>
        ) : (
          <div className="stack">
            {pending.map((u) => (
              <div className="card" key={u.id}>
                <div className="receipt__store">{u.storeName}</div>
                <div className="receipt__meta">신청일 {formatKDate(u.createdAt)}</div>
                <div className="divider" />
                <div className="kv">
                  <span className="kv__k">아이디</span>
                  <span className="kv__v">{u.username}</span>
                </div>
                <div className="kv">
                  <span className="kv__k">연락처</span>
                  <span className="kv__v">{u.phone}</span>
                </div>
                <div className="kv">
                  <span className="kv__k">주소</span>
                  <span className="kv__v">{u.address}</span>
                </div>
                {u.businessCert && (
                  <div className="kv">
                    <span className="kv__k">사업자등록증</span>
                    <a
                      className="kv__v"
                      href={u.businessCert}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "underline" }}
                    >
                      보기
                    </a>
                  </div>
                )}
                <div className="divider" />
                <div style={{ display: "flex", gap: 8 }}>
                  <form action={approveUserAction} style={{ flex: 1 }}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="role" value="MERCHANT_HOTDEAL" />
                    <button className="btn btn--primary btn--sm" style={{ width: "100%" }}>
                      핫딜마켓 가맹점
                    </button>
                  </form>
                  <form action={approveUserAction} style={{ flex: 1 }}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="role" value="MERCHANT_SEOBU" />
                    <button className="btn btn--ghost btn--sm" style={{ width: "100%" }}>
                      서부일광 소매
                    </button>
                  </form>
                </div>
                <form action={rejectUserAction} style={{ marginTop: 8 }}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button className="btn btn--danger btn--sm" style={{ width: "100%" }}>
                    반려
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
