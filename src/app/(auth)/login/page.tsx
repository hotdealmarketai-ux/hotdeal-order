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
        <div style={{ height: 36 }} />
        <div className="brandmark">핫딜마켓</div>
        <h1 className="h1">발주 시스템</h1>
        <p className="lead">아이디와 비밀번호로 로그인하세요.</p>
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
