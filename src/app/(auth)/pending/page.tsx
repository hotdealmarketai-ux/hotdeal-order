import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { homePathFor } from "@/lib/constants";
import { LogoutButton } from "@/components/LogoutButton";

export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status === "APPROVED") redirect(homePathFor(user.role, user.status));

  const rejected = user.status === "REJECTED";

  return (
    <div className="app">
      <div className="page" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div className="center" style={{ padding: "20px 0 28px" }}>
          <div
            className={`statusring ${rejected ? "statusring--rejected" : ""}`}
            aria-hidden
          />
          <h1 className="h1" style={{ marginTop: 20 }}>
            {rejected ? "가입이 반려되었어요" : "승인 대기 중이에요"}
          </h1>
          <p className="lead" style={{ marginTop: 8 }}>
            {rejected
              ? "자세한 내용은 본사에 문의해 주세요."
              : "본사에서 가입 신청을 확인하고 있어요.\n승인되면 바로 발주를 넣을 수 있어요."}
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
              <span className={`badge ${rejected ? "badge--mute" : "badge--wait"}`}>
                {rejected ? "반려" : "승인 대기"}
              </span>
            </span>
          </div>
        </div>

        <p className="hint center" style={{ marginTop: 18 }}>
          승인 후 이 화면을 새로고침하면 발주 화면으로 이동해요.
        </p>
        <div style={{ marginTop: 18 }}>
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
