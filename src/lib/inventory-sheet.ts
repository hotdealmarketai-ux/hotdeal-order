// #12/#22 재고 ↔ 구글시트 2-way 동기화.
//  · 읽기(pull, 시트→DB): 크론이 매 분 호출. 서비스계정이 있으면 Sheets API(비공개 시트 OK),
//    없으면 공개 시트 CSV export로 폴백.
//  · 쓰기(push, DB→시트): 관리자가 앱에서 수정/추가/제거하면 DB 전체를 시트에 다시 써서 일치시킴.
// 컬럼: A=품목명, B=남은 수량, C=공급가. 1행은 헤더. 시트가 기준(시트에 없는 품목은 pull 시 삭제).
//
// 데이터 정합 안전장치(리뷰 반영):
//  · push는 데이터영역(A2:C)을 clear한 뒤 다시 쓴다 → 삭제된 품목이 잔여행으로 부활하지 않음(결정론적).
//  · push 실패 시 'inventory_push_pending' 플래그를 남기고, 다음 pull은 먼저 재-push(flush)를 시도한다.
//    flush가 실패하면 그 회차 pull은 DB를 건드리지 않는다 → 아직 시트에 못 올린 앱 편집이 pull에 덮이거나
//    삭제되지 않도록 보호. flush 성공 시 플래그 해제 후 정상 pull.
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";
import { getGoogleAccessToken, hasGoogleCreds } from "@/lib/google-auth";

const SHEET_ID =
  process.env.INVENTORY_SHEET_ID ||
  "1LlMirhN-ChqWKmzilH1_EX7yeDLK26SI-H61bvgGEG0";
const GID = process.env.INVENTORY_SHEET_GID || "0";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
const HEADER = ["품목명", "남은 수량", "공급가"];
const PENDING_KEY = "inventory_push_pending";

// A1 표기에서 탭 이름은 작은따옴표로 감싸고 내부 '는 ''로 이스케이프(공백·특수문자 대비).
const a1 = (title: string, rng: string) =>
  `'${title.replace(/'/g, "''")}'!${rng}`;

// 인증 fetch — 8초 타임아웃(관리자 액션이 구글 지연에 매달리지 않도록).
function gfetch(url: string, token: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
}

// ── 최소 CSV 파서(공개 시트 폴백용) ──
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const toInt = (s: string | undefined) =>
  parseInt(String(s ?? "").replace(/[^0-9-]/g, ""), 10) || 0;

type Row = { name: string; qty: number; supplyPrice: number };

function rowsFromMatrix(matrix: string[][]): Row[] {
  return matrix
    .slice(1) // 헤더 제외
    .map((r) => ({
      name: (r[0] ?? "").trim(),
      qty: toInt(r[1]),
      supplyPrice: toInt(r[2]),
    }))
    .filter((it) => it.name);
}

// GID → 탭 제목 해석. 정확히 일치하는 탭이 없으면: 탭이 하나뿐이면 그걸 쓰고,
// 여러 개면 '엉뚱한 탭 쓰기'를 막기 위해 예외를 던진다(#15).
async function sheetTitleForGid(token: string): Promise<string> {
  const res = await gfetch(
    `${API}?fields=sheets.properties(sheetId,title)`,
    token,
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`sheet meta ${res.status}: ${JSON.stringify(j)}`);
  const gid = parseInt(GID, 10) || 0;
  const sheets: { properties?: { sheetId?: number; title?: string } }[] =
    Array.isArray(j.sheets) ? j.sheets : [];
  const exact = sheets.find((s) => s.properties?.sheetId === gid);
  if (exact?.properties?.title) return exact.properties.title;
  if (sheets.length === 1 && sheets[0].properties?.title)
    return sheets[0].properties.title;
  throw new Error(`gid ${gid} 탭을 찾을 수 없어요(탭 ${sheets.length}개).`);
}

// ── 읽기(pull) ─────────────────────────────────────────────
async function readRowsViaApi(): Promise<Row[]> {
  const token = await getGoogleAccessToken(SCOPE);
  const title = await sheetTitleForGid(token);
  const range = encodeURIComponent(a1(title, "A1:C"));
  const res = await gfetch(`${API}/values/${range}?majorDimension=ROWS`, token);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`values.get ${res.status}: ${JSON.stringify(j)}`);
  const matrix: string[][] = Array.isArray(j.values) ? j.values : [];
  return rowsFromMatrix(matrix);
}

async function readRowsViaCsv(): Promise<Row[] | { error: string }> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { error: `sheet fetch ${res.status}` };
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    return {
      error:
        "시트가 공개(링크공유)가 아니에요. 서비스계정 공유 또는 '링크가 있는 모든 사용자 보기'로 공유해 주세요.",
    };
  }
  return rowsFromMatrix(parseCsv(text));
}

export async function syncInventoryFromSheet(): Promise<{
  ok: boolean;
  count?: number;
  error?: string;
}> {
  // push가 밀려 있으면(앱 편집이 아직 시트에 반영 안 됨) 먼저 flush를 시도.
  // flush가 실패하면 이번 pull은 DB를 건드리지 않는다 → 미반영 앱 편집을 시트값으로 덮거나 삭제하지 않도록 보호.
  if (hasGoogleCreds()) {
    const pending = await prisma.appMeta
      .findUnique({ where: { key: PENDING_KEY } })
      .catch(() => null);
    if (pending) {
      const flushed = await safePushInventory();
      if (!flushed.ok) {
        return { ok: false, error: "시트 반영 대기 중 — pull 건너뜀(앱 편집 보호)" };
      }
    }
  }

  let items: Row[];
  try {
    if (hasGoogleCreds()) {
      items = await readRowsViaApi();
    } else {
      const csv = await readRowsViaCsv();
      if (!Array.isArray(csv)) return { ok: false, error: csv.error };
      items = csv;
    }
  } catch (err) {
    logError("inventory.sheetRead", err, {});
    return { ok: false, error: "시트 조회 실패" };
  }

  // 빈 응답이면 DB를 지우지 않는다(전량 삭제 사고 방지).
  if (items.length === 0) return { ok: false, error: "시트에 품목이 없어요" };

  // 시트에 같은 이름이 여러 번 있으면(사용자 실수) 첫 번째만 채택 — 이름이 동기화 키라서.
  const dedup = new Set<string>();
  items = items.filter((it) => {
    if (dedup.has(it.name)) return false;
    dedup.add(it.name);
    return true;
  });

  const names = items.map((i) => i.name);
  // 트랜잭션 내 findFirst N회를 없애기 위해 이름→id 맵을 미리 1회 조회(대량 품목 시 타임아웃 방지).
  const existingRows = await prisma.inventoryItem.findMany({
    select: { id: true, name: true },
  });
  const idByName = new Map<string, string>();
  for (const r of existingRows) if (!idByName.has(r.name)) idByName.set(r.name, r.id);

  try {
    await prisma.$transaction(
      async (tx) => {
        // 시트=기준: 시트에 없는 품목은 삭제(삭제 전파).
        await tx.inventoryItem.deleteMany({ where: { name: { notIn: names } } });
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const id = idByName.get(it.name);
          if (id) {
            await tx.inventoryItem.update({
              where: { id },
              data: { qty: it.qty, supplyPrice: it.supplyPrice, sortOrder: i },
            });
          } else {
            await tx.inventoryItem.create({
              data: {
                name: it.name,
                qty: it.qty,
                supplyPrice: it.supplyPrice,
                sortOrder: i,
                status: "",
              },
            });
          }
        }
      },
      { timeout: 20000 },
    );
  } catch (err) {
    logError("inventory.reconcile", err, {});
    return { ok: false, error: "동기화 저장 실패" };
  }

  await prisma.appMeta.upsert({
    where: { key: "inventory_sync" },
    create: { key: "inventory_sync" },
    update: { syncedAt: new Date() },
  });
  return { ok: true, count: items.length };
}

// ── 쓰기(push, DB→시트) ────────────────────────────────────
// 데이터영역(A2:C)을 먼저 비운 뒤 헤더+전체 품목을 다시 쓴다(전체 재작성, 결정론적 삭제).
export async function pushInventoryToSheet(): Promise<{
  ok: boolean;
  count?: number;
  error?: string;
}> {
  if (!hasGoogleCreds()) return { ok: false, error: "no-credentials" };

  let token: string;
  let title: string;
  try {
    token = await getGoogleAccessToken(SCOPE);
    title = await sheetTitleForGid(token);
  } catch (err) {
    logError("inventory.push.auth", err, {});
    return { ok: false, error: "auth" };
  }

  const dbItems = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true, qty: true, supplyPrice: true },
  });
  const values: string[][] = [
    HEADER,
    ...dbItems.map((it) => [it.name, String(it.qty), String(it.supplyPrice)]),
  ];

  try {
    // 1) 데이터영역 전체 비우기(잔여 옛 행 확실 제거). 헤더(1행)는 유지.
    const clearRange = encodeURIComponent(a1(title, "A2:C"));
    const clr = await gfetch(`${API}/values/${clearRange}:clear`, token, {
      method: "POST",
    });
    if (!clr.ok) {
      const t = await clr.text();
      logError("inventory.push.clear", new Error(t), { status: clr.status });
      return { ok: false, error: `clear ${clr.status}` };
    }
    // 2) 헤더 + 전체 품목 다시 쓰기.
    const updRange = encodeURIComponent(a1(title, `A1:C${values.length}`));
    const upd = await gfetch(
      `${API}/values/${updRange}?valueInputOption=RAW`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      },
    );
    if (!upd.ok) {
      const t = await upd.text();
      logError("inventory.push.update", new Error(t), { status: upd.status });
      return { ok: false, error: `update ${upd.status}` };
    }
  } catch (err) {
    logError("inventory.push.write", err, {});
    return { ok: false, error: "write" };
  }

  await prisma.appMeta.upsert({
    where: { key: "inventory_push" },
    create: { key: "inventory_push" },
    update: { syncedAt: new Date() },
  });
  return { ok: true, count: dbItems.length };
}

// 관리자 수정/추가/제거 후 호출하는 안전 래퍼 — 재시도(최대 3회) + pending 플래그 관리.
// 성공: pending 해제. 실패: pending 설정(다음 pull이 먼저 flush 시도하고, 실패하면 DB 보호).
// retries: 재시도 횟수(관리자 폼 액션은 1로 즉시 반환 — 재시도는 다음 pull의 flush가 대신 처리).
export async function safePushInventory(retries = 3): Promise<{
  ok: boolean;
  error?: string;
}> {
  const attempts = Math.max(1, retries);
  let res: { ok: boolean; error?: string } = { ok: false, error: "push-failed" };
  for (let i = 0; i < attempts; i++) {
    res = await pushInventoryToSheet();
    if (res.ok || res.error === "no-credentials") break;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }
  if (res.error === "no-credentials") return res; // 미설정 — 조용히 통과
  try {
    if (res.ok) {
      await prisma.appMeta.deleteMany({ where: { key: PENDING_KEY } });
    } else {
      await prisma.appMeta.upsert({
        where: { key: PENDING_KEY },
        create: { key: PENDING_KEY },
        update: { syncedAt: new Date() },
      });
    }
  } catch (err) {
    logError("inventory.push.flag", err, {});
  }
  return res;
}

export async function lastInventorySyncAt(): Promise<Date | null> {
  const m = await prisma.appMeta
    .findUnique({ where: { key: "inventory_sync" } })
    .catch(() => null);
  return m?.syncedAt ?? null;
}

export async function lastInventoryPushAt(): Promise<Date | null> {
  const m = await prisma.appMeta
    .findUnique({ where: { key: "inventory_push" } })
    .catch(() => null);
  return m?.syncedAt ?? null;
}

// 마지막 push가 실패해 시트 반영이 밀려 있는지(관리자 화면 경고 배너용).
export async function inventoryPushPending(): Promise<boolean> {
  const m = await prisma.appMeta
    .findUnique({ where: { key: PENDING_KEY } })
    .catch(() => null);
  return !!m;
}

export function inventorySyncConfigured(): boolean {
  return hasGoogleCreds();
}
