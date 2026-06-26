import { logoutAction } from "@/app/actions/auth";

export function LogoutButton({
  className = "btn btn--ghost",
  label = "로그아웃",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <form action={logoutAction}>
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
