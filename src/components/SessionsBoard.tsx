"use client";

// 관리자 '로그인 현황' — 가맹점별 활성 로그인(기기) 목록을 6초마다 갱신.
// 기기 1개씩 강제 로그아웃 / 지점 전체 로그아웃.
import { useEffect, useRef, useState, useTransition } from "react";
import type { AdminSessionGroup } from "@/lib/user-session";
import { revokeSessionAction, revokeAllUserSessionsAction } from "@/app/actions/sessions";

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "방금";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
function when(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function SessionsBoard({ initial }: { initial: AdminSessionGroup[] }) {
  const [groups, setGroups] = useState<AdminSessionGroup[]>(initial);
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/admin/sessions", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { groups: AdminSessionGroup[] };
      setGroups(data.groups ?? []);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    timer.current = setInterval(refresh, 6000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function kick(sessionId: string) {
    setBusyId(sessionId);
    start(async () => {
      await revokeSessionAction(sessionId);
      await refresh();
      setBusyId(null);
    });
  }
  function kickAll(userId: string, storeName: string, online: number) {
    if (!window.confirm(`${storeName}의 로그인 ${online}개를 모두 강제 로그아웃할까요?`)) return;
    setBusyId(userId);
    start(async () => {
      await revokeAllUserSessionsAction(userId);
      await refresh();
      setBusyId(null);
    });
  }

  const totalOnline = groups.reduce((a, g) => a + g.onlineCount, 0);
  const totalSessions = groups.reduce((a, g) => a + g.total, 0);

  return (
    <div>
      <div className="sess-strip">
        <div className="sess-strip__item">
          <b>{groups.filter((g) => g.onlineCount > 0).length}</b>
          <span>접속 중 지점</span>
        </div>
        <div className="sess-strip__item">
          <b>{totalOnline}</b>
          <span>접속 중 기기</span>
        </div>
        <div className="sess-strip__item">
          <b>{totalSessions}</b>
          <span>활성 로그인</span>
        </div>
        <div className="sess-strip__live">
          <span className="sess-dot sess-dot--on" /> 6초마다 자동 갱신
          {pending && <span className="sess-muted"> · 처리 중…</span>}
        </div>
      </div>

      {groups.length === 0 && (
        <div className="empty">현재 로그인 중인 가맹점이 없습니다.</div>
      )}

      {groups.map((g) => (
        <div className="card sess-card" key={g.userId}>
          <div className="sess-head">
            <div className="sess-head__l">
              <div className="sess-store">{g.storeName}</div>
              <div className="sess-muted">{g.username}</div>
            </div>
            <div className="sess-head__r">
              <span className={`sess-badge ${g.onlineCount > 0 ? "is-on" : ""}`}>
                {g.onlineCount > 0 ? `🟢 ${g.onlineCount}명 접속 중` : "오프라인"}
                {g.total > g.onlineCount ? ` · 총 ${g.total}대` : ""}
              </span>
              {g.total > 1 && (
                <button
                  className="btn btn--danger btn--sm"
                  disabled={pending}
                  onClick={() => kickAll(g.userId, g.storeName, g.total)}
                >
                  전체 로그아웃
                </button>
              )}
            </div>
          </div>

          <div className="sess-list">
            {g.sessions.map((s) => (
              <div className={`sess-row ${s.online ? "is-on" : ""}`} key={s.id}>
                <span className={`sess-dot ${s.online ? "sess-dot--on" : ""}`} />
                <div className="sess-row__main">
                  <div className="sess-row__dev">
                    {s.device}
                    {s.ip ? <span className="sess-muted"> · {s.ip}</span> : null}
                  </div>
                  <div className="sess-row__meta sess-muted">
                    로그인 {when(s.createdAt)} · 활동 {s.online ? "지금" : ago(s.lastSeenAt)}
                  </div>
                </div>
                <button
                  className="btn btn--soft btn--sm"
                  disabled={pending && busyId === s.id}
                  onClick={() => kick(s.id)}
                >
                  로그아웃
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <style>{`
        .sess-strip{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
        .sess-strip__item{background:var(--surface,#fff);border:1px solid var(--line,#e3e8e5);border-radius:12px;padding:8px 14px;min-width:78px}
        .sess-strip__item b{display:block;font-size:20px;font-weight:800;line-height:1.1}
        .sess-strip__item span{font-size:11.5px;color:var(--muted,#6b7a72)}
        .sess-strip__live{margin-left:auto;font-size:12px;color:var(--muted,#6b7a72);display:flex;align-items:center;gap:6px}
        .sess-muted{color:var(--muted,#6b7a72)}
        .sess-card{margin-bottom:12px;padding:14px 16px}
        .sess-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px}
        .sess-store{font-weight:800;font-size:16px}
        .sess-head__r{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
        .sess-badge{font-size:12.5px;font-weight:700;color:var(--muted,#6b7a72);background:var(--surface-2,#f4f7f5);border:1px solid var(--line,#e3e8e5);border-radius:20px;padding:3px 10px;white-space:nowrap}
        .sess-badge.is-on{color:#0f6b45;background:#e4f1ea;border-color:#bfe0cf}
        .sess-list{display:flex;flex-direction:column;gap:8px}
        .sess-row{display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--line,#e3e8e5);border-radius:10px;background:var(--surface-2,#f7faf8)}
        .sess-row.is-on{border-color:#bfe0cf;background:#f2fbf6}
        .sess-row__main{flex:1;min-width:0}
        .sess-row__dev{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .sess-row__meta{font-size:12px;margin-top:1px}
        .sess-dot{width:9px;height:9px;border-radius:50%;background:#c3ccc7;flex:none}
        .sess-dot--on{background:#22a35f;box-shadow:0 0 0 3px rgba(34,163,95,.15)}
      `}</style>
    </div>
  );
}
