import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ROLE_LABEL, isMerchant, type Role } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import { CollectDepositsButton } from "@/components/CollectDepositsButton";
import { DepositMatchControl } from "@/components/DepositMatchControl";
import {
  unmatchDepositAction,
  resetDepositAction,
} from "@/app/actions/deposit";

const fmt = (n: number) => n.toLocaleString("ko-KR");

export default async function AdminDeposits() {
  await requireAdmin();

  const [deposits, merchants] = await Promise.all([
    prisma.deposit.findMany({
      orderBy: { txAt: "desc" },
      take: 200,
      include: { matchedUser: { select: { storeName: true } } },
    }),
    prisma.user.findMany({
      where: { role: { in: ["MERCHANT_HOTDEAL", "MERCHANT_SEOBU"] }, status: "APPROVED" },
      select: { id: true, storeName: true, role: true },
      orderBy: { storeName: "asc" },
    }),
  ]);

  const stores = merchants
    .filter((m) => isMerchant(m.role as Role))
    .map((m) => ({
      id: m.id,
      label: `${m.storeName} (${ROLE_LABEL[m.role as Role]})`,
    }));

  const unmatched = deposits.filter((d) => d.matchStatus === "UNMATCHED");
  const matched = deposits.filter(
    (d) => d.matchStatus === "AUTO" || d.matchStatus === "MANUAL",
  );
  const ignored = deposits.filter((d) => d.matchStatus === "IGNORED");

  return (
    <>
      <header className="topbar">
        <Link href="/admin" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">입금 내역</div>
      </header>
      <div className="page">
        <p className="lead" style={{ marginTop: 0 }}>
          하나 법인계좌 입금 {deposits.length}건
          {unmatched.length > 0 ? ` · 미매칭 ${unmatched.length}건` : ""}
        </p>

        <CollectDepositsButton />

        {deposits.length === 0 ? (
          <div className="empty">
            <p>아직 수집된 입금 내역이 없어요.</p>
            <p className="hint">
              팝빌 계좌조회에서 입금이 들어오면 자동으로 여기 쌓이고, 입금자명이
              등록된 점포면 계산서까지 자동 처리돼요.
            </p>
          </div>
        ) : (
          <>
            {unmatched.length > 0 && (
              <>
                <div className="section-label">확인 필요 (미매칭)</div>
                <div className="list">
                  {unmatched.map((d) => (
                    <div className="deprow" key={d.id}>
                      <div className="deprow__head">
                        <div className="row__main">
                          <div className="row__title">
                            {d.payerName || "(입금자명 없음)"} · {fmt(d.amount)}원
                          </div>
                          <div className="row__sub">
                            {formatKDateTime(d.txAt)}
                            {d.memo ? ` · ${d.memo}` : ""}
                          </div>
                        </div>
                        <DepositMatchControl
                          depositId={d.id}
                          payerName={d.payerName}
                          stores={stores}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {matched.length > 0 && (
              <>
                <div className="section-label">매칭됨</div>
                <div className="list">
                  {matched.map((d) => (
                    <div className="row" key={d.id}>
                      <div className="row__main">
                        <div className="row__title">
                          {d.payerName || "(입금자명 없음)"} · {fmt(d.amount)}원
                        </div>
                        <div className="row__sub">
                          {formatKDateTime(d.txAt)} ·{" "}
                          {d.matchedUser?.storeName ?? "?"}
                          {d.matchStatus === "AUTO" ? " · 자동" : " · 수동"}
                        </div>
                      </div>
                      <form action={unmatchDepositAction}>
                        <input type="hidden" name="depositId" value={d.id} />
                        <button type="submit" className="linkbtn">
                          해제
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              </>
            )}

            {ignored.length > 0 && (
              <>
                <div className="section-label">무시됨</div>
                <div className="list">
                  {ignored.map((d) => (
                    <div className="row" key={d.id}>
                      <div className="row__main">
                        <div className="row__title" style={{ color: "var(--muted)" }}>
                          {d.payerName || "(입금자명 없음)"} · {fmt(d.amount)}원
                        </div>
                        <div className="row__sub">{formatKDateTime(d.txAt)}</div>
                      </div>
                      <form action={resetDepositAction}>
                        <input type="hidden" name="depositId" value={d.id} />
                        <button type="submit" className="linkbtn">
                          되돌리기
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
