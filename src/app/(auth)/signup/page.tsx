import { Topbar } from "@/components/Topbar";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { homePathFor } from "@/lib/constants";
import { SignupForm } from "@/components/SignupForm";

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user.role, user.status));

  return (
    <div className="app">
      <Topbar backHref="/login" title="가입 신청" />
      <div className="page">
        <h1 className="h1">가입 신청</h1>
        <p className="lead">
          아래 정보를 입력하면 본사 승인 후 발주를 넣을 수 있어요.
        </p>
        <SignupForm />
      </div>
    </div>
  );
}
