import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { homePathFor } from "@/lib/constants";
import { LogoutButton } from "@/components/LogoutButton";
import { PushToggle } from "@/components/PushToggle";

export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status === "APPROVED") redirect(homePathFor(user.role, user.status));

  const suspended = user.status === "SUSPENDED";
  const rejected = user.status === "REJECTED";
  const stopped = suspended || rejected;

  const heading = suspended
    ? "계정이 정지되었어요"
    : rejected
      ? "가입이 반려되었어요"
      : "가입 신청이 접수되었어요";
  const message = suspended
    ? "계정이 정지된 상태예요. 본사에 문의해 주세요."
    : rejected
      ? "자세한 내용은 본사에 문의해 주세요."
      : "본사에서 가입 신청을 확인하고 있어요.\n승인되면 바로 발주를 넣을 수 있어요.";
  const statusLabel = suspended ? "정지" : rejected ? "반려" : "승인 대기";

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
