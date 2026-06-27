import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { homePathFor } from "@/lib/constants";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user.role, user.status));

  return (
    <div className="app">
      <div className="page">
        <div style={{ height: 44 }} />
        <div className="authbrand">
          <div className="authbrand__name">
            오더야 <span className="authbrand__en">ORDERYA</span>
          </div>
          <p className="authbrand__desc">
            주문은 더 간편하게, 운영은 더 스마트하게.
          </p>
        </div>
        <LoginForm />
        <div className="center" style={{ marginTop: 24 }}>
          <span className="muted" style={{ fontSize: 15 }}>
            아직 회원이 아니신가요?{" "}
          </span>
          <Link href="/signup" style={{ fontWeight: 700 }}>
            가입 신청
          </Link>
        </div>
      </div>
    </div>
  );
}
