// 백업 현황판 — GitHub Actions(백업 워크플로) 상태를 읽고, 수동 실행/다운로드를 중계한다. 서버 전용.
// 토큰(GH_BACKUP_TOKEN)이 없으면 configured:false 로만 반환 → 화면은 '설정 안내'를 띄운다(크래시 X).
//  · 필요한 토큰: fine-grained PAT, 이 저장소에 Actions(read+write) + Contents(read) 권한.
//  · GH_BACKUP_REPO = "owner/repo" (기본 hotdealmarketai-ux/hotdeal-order)
// (이 파일은 서버 컴포넌트/액션/라우트에서만 import — 토큰이 클라이언트로 새지 않음)

const REPO = process.env.GH_BACKUP_REPO || "hotdealmarketai-ux/hotdeal-order";
const TOKEN = process.env.GH_BACKUP_TOKEN || "";
const API = "https://api.github.com";

export const BACKUP_WORKFLOWS = [
  { key: "db", name: "DB 전체 백업", file: "db-backup.yml" },
  { key: "media", name: "미디어(사진·첨부) 백업", file: "media-backup.yml" },
  { key: "verify", name: "복원 자동검증", file: "restore-verify.yml" },
] as const;

export type WfRun = {
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | null
  createdAt: string;
  url: string;
};
export type WfStatus = { key: string; name: string; file: string; lastRun: WfRun | null };
export type ArtifactInfo = {
  id: number;
  name: string;
  sizeMB: number;
  createdAt: string;
  expired: boolean;
};
export type BackupStatus = {
  configured: boolean;
  repo: string;
  workflows: WfStatus[];
  dbArtifacts: ArtifactInfo[];
  mediaArtifacts: ArtifactInfo[];
};

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { headers: headers(), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function isBackupConfigured(): boolean {
  return !!TOKEN;
}

export async function getBackupStatus(): Promise<BackupStatus> {
  if (!TOKEN) {
    return { configured: false, repo: REPO, workflows: [], dbArtifacts: [], mediaArtifacts: [] };
  }
  const [runsResults, artifactsRes] = await Promise.all([
    Promise.all(
      BACKUP_WORKFLOWS.map((w) =>
        ghGet<{ workflow_runs: Array<Record<string, unknown>> }>(
          `/repos/${REPO}/actions/workflows/${w.file}/runs?per_page=1`,
        ),
      ),
    ),
    ghGet<{ artifacts: Array<Record<string, unknown>> }>(
      `/repos/${REPO}/actions/artifacts?per_page=100`,
    ),
  ]);

  const workflows: WfStatus[] = BACKUP_WORKFLOWS.map((w, i) => {
    const run = runsResults[i]?.workflow_runs?.[0];
    return {
      key: w.key,
      name: w.name,
      file: w.file,
      lastRun: run
        ? {
            status: String(run.status ?? ""),
            conclusion: (run.conclusion as string | null) ?? null,
            createdAt: String(run.created_at ?? ""),
            url: String(run.html_url ?? ""),
          }
        : null,
    };
  });

  const arts = (artifactsRes?.artifacts ?? [])
    .map((a): ArtifactInfo => ({
      id: Number(a.id),
      name: String(a.name ?? ""),
      sizeMB: Math.round((Number(a.size_in_bytes ?? 0) / 1024 / 1024) * 10) / 10,
      createdAt: String(a.created_at ?? ""),
      expired: Boolean(a.expired),
    }))
    .filter((a) => !a.expired);
  const byNewest = (a: ArtifactInfo, b: ArtifactInfo) =>
    b.createdAt.localeCompare(a.createdAt);
  const dbArtifacts = arts.filter((a) => a.name.startsWith("neon-backup")).sort(byNewest).slice(0, 5);
  const mediaArtifacts = arts.filter((a) => a.name.startsWith("media-backup")).sort(byNewest).slice(0, 5);

  return { configured: true, repo: REPO, workflows, dbArtifacts, mediaArtifacts };
}

// 워크플로 수동 실행(workflow_dispatch). 성공 시 true.
export async function dispatchWorkflow(file: string): Promise<boolean> {
  if (!TOKEN) return false;
  try {
    const res = await fetch(`${API}/repos/${REPO}/actions/workflows/${file}/dispatches`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
    });
    return res.ok; // 204 = 성공
  } catch {
    return false;
  }
}

// 최신(만료 안 된) 아티팩트의 다운로드 zip 바이트. 다운로드 라우트가 그대로 스트리밍.
export async function fetchLatestArtifactZip(
  kind: "db" | "media",
): Promise<{ bytes: ArrayBuffer; filename: string } | null> {
  if (!TOKEN) return null;
  const status = await getBackupStatus();
  const art = (kind === "db" ? status.dbArtifacts : status.mediaArtifacts)[0];
  if (!art) return null;
  // /zip 은 302로 서명 URL로 리다이렉트 → fetch가 따라가 바이트를 받는다.
  const res = await fetch(`${API}/repos/${REPO}/actions/artifacts/${art.id}/zip`, {
    headers: headers(),
  });
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  return { bytes, filename: `${art.name}.zip` };
}
