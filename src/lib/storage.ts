// ============================================================
//  사업자등록증 파일 저장
//  - Supabase 자격증명 있으면 Supabase Storage 업로드
//  - 없으면 로컬 public/uploads 에 저장(개발/온프레미스)
// ============================================================
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const ALLOWED_EXT = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

// 화이트리스트 밖 확장자는 .bin 으로 저장 → HTML/SVG 등 브라우저 실행형 파일 차단(저장형 XSS 방지)
function safeExt(name: string, type: string): string {
  const fromName = path.extname(name || "").replace(".", "").toLowerCase();
  if (ALLOWED_EXT.has(fromName)) return fromName;
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("pdf")) return "pdf";
  return "bin";
}

/** 파일을 저장하고 접근 가능한 URL/경로를 반환. 실패하면 null. */
export async function saveBusinessCert(file: File | null): Promise<string | null> {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) return null;
  if (file.size > MAX_BYTES) return null;

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = safeExt(file.name, file.type);
  const key = `${randomUUID()}.${ext}`;

  // 운영: Supabase Storage
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "business-certs";
  if (supaUrl && supaKey) {
    try {
      const endpoint = `${supaUrl.replace(/\/$/, "")}/storage/v1/object/${bucket}/${key}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supaKey}`,
          "Content-Type": file.type || "application/octet-stream",
          "x-upsert": "true",
        },
        body: buf,
      });
      if (res.ok) {
        return `${supaUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${key}`;
      }
      console.error("[storage] supabase upload failed:", res.status, await res.text());
    } catch (err) {
      console.error("[storage] supabase upload error, falling back to local:", err);
    }
  }

  // 개발: 로컬 public/uploads
  const dir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, key), buf);
  return `/uploads/${key}`;
}
