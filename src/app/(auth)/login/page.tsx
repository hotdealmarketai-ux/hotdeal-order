import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { homePathFor } from "@/lib/constants";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const nextRaw = typeof sp.next === "string" ? sp.next : "";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : undefined;
  const user = await getCurrentUser();
  // 이미 로그인돼 있으면 자기 홈으로(next는 신선 로그인 때만 사용 — 권한 불일치 리다이렉트 루프 방지).
  if (user) redirect(homePathFor(user.role, user.status));

  return (
    <div className="app">
      <div className="page">
        <div style={{ height: 44 }} />
        <div className="authbrand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="핫딜오더" className="authbrand__logo" />
          <div className="authbrand__name">핫딜오더</div>
          <p className="authbrand__desc">
            주문은 더 간편하게, 운영은 더 스마트하게.
          </p>
        </div>
        <LoginForm next={next} />
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
