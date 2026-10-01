import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getBackupStatus, type WfStatus, type ArtifactInfo } from "@/lib/github-backup";
import { formatKDateTime } from "@/lib/format";
import { BackupActions } from "@/components/BackupActions";

// 백업 현황판 — 백업이 '잘 되고 있는지'를 관리자가 한눈에. (조용한 실패 재발 방지)
export const dynamic = "force-dynamic";

function badgeOf(r: WfStatus["lastRun"]): { label: string; cls: string } {
  if (!r) return { label: "기록 없음", cls: "" };
  if (r.status !== "completed") return { label: "진행 중", cls: "badge--wait" };
  if (r.conclusion === "success") return { label: "성공", cls: "badge--ok" };
  if (r.conclusion === "failure") return { label: "실패", cls: "badge--danger" };
  return { label: r.conclusion ?? r.status, cls: "" };
}

const when = (iso: string) => (iso ? formatKDateTime(new Date(iso)) : "—");

function ArtifactList({ title, arts }: { title: string; arts: ArtifactInfo[] }) {
  return (
    <div style={{ flex: "1 1 260px" }}>
      <div className="row__sub" style={{ fontWeight: 700, color: "var(--fg)", marginBottom: 6 }}>
        {title}
      </div>
      {arts.length === 0 ? (
        <div className="row__sub" style={{ color: "var(--muted)" }}>보관된 백업 파일이 없어요.</div>
      ) : (
        <div className="list">
          {arts.map((a) => (
            <div className="row" key={a.id}>
              <div className="row__main">
                <div className="row__title" style={{ fontSize: 14 }}>{a.name}</div>
                <div className="row__sub">{when(a.createdAt)}</div>
              </div>
              <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {a.sizeMB} MB
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function AdminBackupPage() {
  await requireAdmin();
  const st = await getBackupStatus();

  if (!st.configured) {
    return (
      <>
        <Topbar backHref="/admin" title="백업 관리" />
        <div className="page">
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row__sub" style={{ fontWeight: 700, color: "var(--fg)" }}>
              아직 연결 전이에요
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.6 }}>
              백업 현황을 보려면 GitHub 읽기용 토큰이 한 번만 필요합니다.
              <br />
              1. GitHub → Settings → Developer settings → Fine-grained tokens 에서
              이 저장소({st.repo})에 <b>Actions: Read and write</b>, <b>Contents: Read</b> 권한 토큰 발급
              <br />
              2. Vercel 프로젝트 환경변수에 <b>GH_BACKUP_TOKEN</b> = (그 토큰) 추가 후 재배포
              <br />
              (백업 자체는 이미 매일 자동으로 돌고 있어요 — 이건 '화면에서 보기' 용도입니다.)
            </div>
          </div>
        </div>
      </>
    );
  }

  const anyFail = st.workflows.some((w) => w.lastRun?.conclusion === "failure");
  const noDbBackup = st.dbArtifacts.length === 0;

  return (
    <>
      <Topbar backHref="/admin" title="백업 관리" />
      <div className="page">
        {anyFail && (
          <div className="notice notice--error" style={{ marginBottom: 12 }}>
            ⚠️ 최근 백업 중 <b>실패</b>한 항목이 있어요. 아래에서 확인하고 '지금 백업'으로 다시 시도하세요.
          </div>
        )}
        {noDbBackup && !anyFail && (
          <div className="notice notice--error" style={{ marginBottom: 12 }}>
            ⚠️ 보관된 DB 백업 파일이 없습니다. '지금 백업'을 눌러 백업을 만들어 주세요.
          </div>
        )}

        {/* 워크플로 상태 */}
        <div className="section-label">백업 상태</div>
        <div className="list" style={{ marginBottom: 16 }}>
          {st.workflows.map((w) => {
            const b = badgeOf(w.lastRun);
            return (
              <div className="row" key={w.key}>
                <div className="row__main">
                  <div className="row__title">{w.name}</div>
                  <div className="row__sub">
                    마지막 실행 {when(w.lastRun?.createdAt ?? "")}
                    {w.lastRun?.url ? (
                      <>
                        {" · "}
                        <a href={w.lastRun.url} target="_blank" rel="noreferrer" style={{ color: "var(--muted)" }}>
                          기록 보기
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
                <span
                  className={`badge ${b.cls}`}
                  style={{ minHeight: 32, padding: "0 14px", fontSize: 13, borderRadius: 999 }}
                >
                  {b.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* 보관 중인 백업 파일 */}
        <div className="section-label">보관 중인 백업 (최근 5개, 30일 보관)</div>
        <div className="card" style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <ArtifactList title="DB 전체" arts={st.dbArtifacts} />
          <ArtifactList title="미디어(사진·첨부)" arts={st.mediaArtifacts} />
        </div>

        <BackupActions />
      </div>
    </>
  );
}
