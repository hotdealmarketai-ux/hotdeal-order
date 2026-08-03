"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogoutButton } from "./LogoutButton";

// 패치 모드 ON일 때 가맹점 화면 전체를 덮는 안내. 관리자가 OFF하면 자동 복구되도록
// 주기적으로 레이아웃을 다시 검사(router.refresh) — 새로고침 없이도 '바로' 사용 재개.
// 잠금이 풀릴 때까지 떠 있으므로 나갈 수 있게 로그아웃 버튼을 둔다.
export function MaintenanceGate() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="maint">
      <div className="maint__box">
        <div className="maint__mark" aria-hidden="true">
          <span className="maint__dot" />
        </div>
        <div className="maint__title">
          현재 업데이트 작업으로 인하여
          <br />
          사용이 불가능 합니다.
        </div>
        <div className="maint__sub">작업이 끝나면 자동으로 다시 열립니다.</div>
        <div className="maint__foot">
          <LogoutButton className="btn btn--ghost btn--sm" label="로그아웃" />
        </div>
      </div>
    </div>
  );
}
