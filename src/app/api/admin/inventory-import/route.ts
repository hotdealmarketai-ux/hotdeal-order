import { readInventorySheet, setInventoryPushPending } from "@/lib/inventory-sheet";
import { prisma } from "@/lib/prisma";
import { normalizeExpiry } from "@/lib/date";

export const dynamic = "force-dynamic";

// 1회성 '시트 → 앱' 가져오기(명시적, 삭제 없음). CRON_SECRET 보호.
//  · 기본(GET)      : 미리보기(dry-run) — 시트 내용과 추가/갱신 건수만 반환, DB 안 건드림.
//  · ?commit=1      : 반영 — 시트 품목을 이름 기준 upsert(신규 생성 + 기존 갱신). 앱에만 있는 품목은
//                     삭제하지 않는다(단방향 전환 R3의 데이터손실 사고 방지 — 삭제 없이 재설계 지침).
// 반영 후 앱이 기준이 되고, 매분 push 크론이 DB→시트로 미러링한다. 이후 수정은 앱에서.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const commit = new URL(request.url).searchParams.get("commit") === "1";

  const sheet = await readInventorySheet();
  if (!Array.isArray(sheet)) {
    return Response.json({ ok: false, error: sheet.error });
  }

  // 이름 기준 dedup(첫 줄 채택), 빈 이름 제외
  const seen = new Set<string>();
  const rows = sheet.filter((r) => {
    const n = r.name.trim();
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  if (rows.length === 0) {
    return Response.json({
      ok: false,
      error: "시트에서 품목을 못 읽었어요(A열=품목명, 1행=헤더 확인).",
    });
  }

  const current = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  const nameToId = new Map(current.map((c) => [c.name, c.id]));
  const willUpdate = rows.filter((r) => nameToId.has(r.name.trim())).length;
  const willAdd = rows.length - willUpdate;

  if (!commit) {
    return Response.json({
      ok: true,
      dryRun: true,
      sheetItems: rows.length,
      appItemsNow: current.length,
      willAdd,
      willUpdate,
      willDelete: 0,
      note: "삭제 없음 — 앱에만 있는 품목은 그대로 둡니다. 반영하려면 ?commit=1",
      sample: rows.map((r) => ({
        name: r.name,
        qty: r.qty,
        supplyPrice: r.supplyPrice,
        expiry: normalizeExpiry(r.expiry) || r.expiry || "",
      })),
    });
  }

  // ── 반영(삭제 없이 upsert) ──
  const maxAgg = await prisma.inventoryItem.aggregate({ _max: { sortOrder: true } });
  let sort = (maxAgg._max.sortOrder ?? 0) + 1;
  let added = 0;
  let updated = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const r of rows) {
        const name = r.name.trim();
        const exp = normalizeExpiry(r.expiry); // 형식 맞으면 정규화, 아니면 "" (기존 유지)
        const id = nameToId.get(name);
        if (id) {
          await tx.inventoryItem.update({
            where: { id },
            data: {
              qty: r.qty,
              supplyPrice: r.supplyPrice,
              ...(exp ? { expiry: exp } : {}),
            },
          });
          updated++;
        } else {
          await tx.inventoryItem.create({
            data: {
              name,
              qty: r.qty,
              supplyPrice: r.supplyPrice,
              expiry: exp,
              sortOrder: sort++,
            },
          });
          added++;
        }
      }
    },
    { timeout: 20000 },
  );

  await setInventoryPushPending(); // 다음 push 크론이 DB→시트 미러링

  return Response.json({ ok: true, committed: true, added, updated, total: rows.length });
}
