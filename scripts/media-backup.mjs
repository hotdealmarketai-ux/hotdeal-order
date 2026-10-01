// 미디어 백업 — DB(pg_dump)에는 파일 'URL'만 들어있고 실물 파일은 외부 스토리지에 있다.
// 그래서 전체 복구가 '빠짐없이' 되려면 이 실물 파일들도 따로 받아 둬야 한다.
//  · Supabase Storage(bucket "business-certs"): 사업자등록증 + 온보딩 튜토리얼 이미지
//  · Vercel Blob: 메신저/관리자문의 채팅 첨부, 회의록, 공지 이미지
// 각 저장소는 해당 시크릿이 있을 때만 백업한다(없으면 건너뜀 — 그 저장소를 안 쓰는 환경 대비).
// 결과물은 ./media-backup/ 아래에 원래 경로 구조로 저장 → 워크플로가 tar.gz 로 묶어 아티팩트 업로드.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = "media-backup";

async function backupSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "business-certs";
  if (!url || !key) {
    console.log("[supabase] SUPABASE_URL/SERVICE_ROLE_KEY 시크릿 없음 — 건너뜀");
    return 0;
  }
  const base = url.replace(/\/$/, "");
  const authHeaders = { Authorization: `Bearer ${key}`, apikey: key };
  const dir = path.join(OUT, "supabase", bucket);
  await mkdir(dir, { recursive: true });
  let offset = 0;
  let total = 0;
  for (;;) {
    const res = await fetch(`${base}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        prefix: "",
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    if (!res.ok) throw new Error(`[supabase] list 실패 ${res.status}: ${await res.text()}`);
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;
    for (const it of items) {
      if (!it.name || it.id === null) continue; // id=null 은 하위 '폴더'(파일 아님)
      const dl = await fetch(
        `${base}/storage/v1/object/${bucket}/${encodeURIComponent(it.name)}`,
        { headers: authHeaders },
      );
      if (!dl.ok) {
        console.error(`[supabase] 다운로드 실패 ${it.name}: ${dl.status}`);
        continue;
      }
      const buf = Buffer.from(await dl.arrayBuffer());
      await writeFile(path.join(dir, it.name.replace(/[^a-zA-Z0-9._-]/g, "_")), buf);
      total++;
    }
    offset += items.length;
    if (items.length < 1000) break;
  }
  console.log(`[supabase] ${total}개 파일 백업 (bucket=${bucket})`);
  return total;
}

async function backupBlob() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.log("[blob] BLOB_READ_WRITE_TOKEN 시크릿 없음 — 건너뜀");
    return 0;
  }
  const { list } = await import("@vercel/blob");
  const dir = path.join(OUT, "vercel-blob");
  await mkdir(dir, { recursive: true });
  let cursor;
  let total = 0;
  do {
    const out = await list({ token, limit: 1000, cursor });
    for (const b of out.blobs) {
      const res = await fetch(b.downloadUrl || b.url);
      if (!res.ok) {
        console.error(`[blob] 다운로드 실패 ${b.pathname}: ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const safe = b.pathname.replace(/\.\.+/g, "_").replace(/[^a-zA-Z0-9._/-]/g, "_");
      const fp = path.join(dir, safe);
      await mkdir(path.dirname(fp), { recursive: true });
      await writeFile(fp, buf);
      total++;
    }
    cursor = out.hasMore ? out.cursor : undefined;
  } while (cursor);
  console.log(`[blob] ${total}개 파일 백업`);
  return total;
}

const s = await backupSupabase();
const b = await backupBlob();
console.log(`\n총 ${s + b}개 미디어 파일 백업 완료 (supabase=${s}, blob=${b})`);
if (s + b === 0) {
  console.log("⚠ 백업된 파일 0개 — 시크릿 미설정이거나 저장소가 비어 있음. 둘 중 무엇인지 확인 필요.");
}
