import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { homePathFor } from "@/lib/constants";
import { LogoutButton } from "@/components/LogoutButton";
import { PushToggle } from "@/components/PushToggle";

export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status === "APPROVED") {
    const home = homePathFor(user.role, user.status);
    // APPROVED인데 역할 미배정이면 home이 다시 "/pending" → 무한 리다이렉트가 된다.
    // 그 경우에만 리다이렉트하지 않고 대기 화면을 렌더해 락아웃을 막는다.
    if (home !== "/pending") redirect(home);
  }

  // 여기 도달 시 status가 APPROVED면 = 승인됐으나 갈 곳 없음(역할 미배정) = 설정 미완료
  const unassigned = user.status === "APPROVED";
  const suspended = user.status === "SUSPENDED";
  const rejected = user.status === "REJECTED";
  const stopped = suspended || rejected || unassigned;

  const heading = unassigned
    ? "계정을 설정하고 있어요"
    : suspended
      ? "계정이 정지되었어요"
      : rejected
        ? "가입이 반려되었어요"
        : "가입 신청이 접수되었어요";
  const message = unassigned
    ? "계정 역할이 아직 지정되지 않았어요.\n본사에 문의해 주세요."
    : suspended
      ? "계정이 정지된 상태예요."
      : rejected
        ? "자세한 내용은 본사에 문의해 주세요."
        : "본사에서 가입 신청을 확인하고 있어요.\n승인되면 바로 발주를 넣을 수 있어요.";
  const statusLabel = unassigned
    ? "설정 중"
    : suspended
      ? "정지"
      : rejected
        ? "반려"
        : "승인 대기";

  return (
    <div className="app">
      <div className="page" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div className="center" style={{ padding: "20px 0 28px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="핫딜오더"
            width={96}
            height={96}
            style={{ display: "block", margin: "0 auto", objectFit: "contain" }}
          />
          <h1 className="h1" style={{ marginTop: 20 }}>
            {heading}
          </h1>
          <p className="lead" style={{ marginTop: 8 }}>
            {message}
          </p>
        </div>

        <div className="card card--flat">
          <div className="kv">
            <span className="kv__k">상호명</span>
            <span className="kv__v">{user.storeName}</span>
          </div>
          <div className="kv">
            <span className="kv__k">아이디</span>
            <span className="kv__v">{user.username}</span>
          </div>
          <div className="kv">
            <span className="kv__k">상태</span>
            <span className="kv__v">
              <span
                className={`badge ${suspended ? "badge--danger" : rejected ? "badge--mute" : "badge--ok"}`}
              >
                {statusLabel}
              </span>
            </span>
          </div>
        </div>

        {!stopped && (
          <div style={{ marginTop: 14 }}>
            {/* Q7 승인 결과를 푸시로 받도록 대기 중에도 알림 켜기 제공 */}
            <PushToggle />
          </div>
        )}

        <p className="hint center" style={{ marginTop: 18 }}>
          승인 후 이 화면을 새로고침하면 발주 화면으로 이동해요.
        </p>
        <div style={{ marginTop: 18, textAlign: "center" }}>
          <LogoutButton className="linkbtn" />
        </div>
      </div>
    </div>
  );
}
