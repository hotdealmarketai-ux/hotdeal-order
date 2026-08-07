// 소싱 엔진 — 수집(어댑터) → 정규화 → 중복제거(key) → 필터 → AI선별 → upsert(상태 보존).
// 크론과 관리자 '지금 수집'이 이걸 호출. 어댑터가 하나도 안 켜져 있으면 수집 0(관리자 수동 추가는 별도).
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";
import type { RawLead, RawProduct } from "./types";
import { leadAdapters, productAdapters } from "./adapters";
import { isFranchiseName, isBigBrand, looksLikeMealkit } from "./filters";
import { curateLeads, curateProducts } from "./curate";

const norm = (s: string) => s.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
const leadKey = (name: string) => "L:" + norm(name);
const productKey = (name: string, brand: string) => "P:" + norm(brand) + ":" + norm(name);
const DAY = 24 * 60 * 60 * 1000;

function pick<T>(a: T | null | undefined, b: T | null | undefined): T | null {
  return a ?? b ?? null;
}
function mergeLead(a: RawLead, b: RawLead): RawLead {
  return {
    source: a.source,
    sourceRef: a.sourceRef || b.sourceRef,
    name: a.name,
    region: a.region || b.region,
    category: a.category || b.category,
    reviewCount: Math.max(a.reviewCount ?? 0, b.reviewCount ?? 0) || (a.reviewCount ?? b.reviewCount ?? null),
    instagram: a.instagram || b.instagram,
    phone: a.phone || b.phone,
    url: a.url || b.url,
    note: a.note || b.note,
  };
}
function mergeProduct(a: RawProduct, b: RawProduct): RawProduct {
  return {
    source: a.source,
    sourceRef: a.sourceRef || b.sourceRef,
    name: a.name,
    brand: a.brand || b.brand,
    category: a.category || b.category,
    price: pick(a.price, b.price) ?? null,
    reviewCount: Math.max(a.reviewCount ?? 0, b.reviewCount ?? 0) || (a.reviewCount ?? b.reviewCount ?? null),
    url: a.url || b.url,
    imageUrl: a.imageUrl || b.imageUrl,
    note: a.note || b.note,
  };
}

// ── Track A: 로컬 업체 발굴 ──
export async function runLocalSourcing(limit = 40): Promise<{ found: number; kept: number }> {
  const run = await prisma.sourcingRun.create({ data: { track: "LOCAL" } });
  const raws: RawLead[] = [];
  const detail: Record<string, number> = {};
  for (const a of leadAdapters) {
    if (!a.enabled()) continue;
    try {
      const r = await a.run({ limit });
      raws.push(...r);
      detail[a.id] = r.length;
    } catch (e) {
      logError("sourcing.leadAdapter", e, { id: a.id });
      detail[a.id] = -1;
    }
  }
  // 프랜차이즈 제외 + key로 병합
  const byKey = new Map<string, RawLead>();
  for (const r of raws) {
    if (!r.name?.trim() || isFranchiseName(r.name)) continue;
    const k = leadKey(r.name);
    const prev = byKey.get(k);
    byKey.set(k, prev ? mergeLead(prev, r) : r);
  }
  const entries = [...byKey.entries()];
  const scored = await curateLeads(
    entries.map(([, r]) => ({ name: r.name, region: r.region || "", category: r.category || "", reviewCount: r.reviewCount ?? null, note: r.note || "" })),
  );

  let kept = 0;
  for (let i = 0; i < entries.length; i++) {
    const [k, r] = entries[i];
    const s = scored[i] ?? { score: 0, reason: "" };
    try {
      await prisma.sourcingLead.upsert({
        where: { key: k },
        create: {
          key: k, source: r.source, sourceRef: r.sourceRef || "", name: r.name,
          region: r.region || "", category: r.category || "", reviewCount: r.reviewCount ?? null,
          instagram: r.instagram || "", phone: r.phone || "", url: r.url || "",
          trendScore: s.score, reason: s.reason,
        },
        update: {
          source: r.source, sourceRef: r.sourceRef || undefined,
          region: r.region || undefined, category: r.category || undefined,
          reviewCount: r.reviewCount ?? undefined, instagram: r.instagram || undefined,
          phone: r.phone || undefined, url: r.url || undefined,
          trendScore: s.score, reason: s.reason, lastSeenAt: new Date(),
        },
      });
      kept++;
    } catch (e) {
      logError("sourcing.leadUpsert", e, { key: k });
    }
  }
  await prisma.sourcingRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), found: raws.length, kept, detail: JSON.stringify(detail) },
  });
  return { found: raws.length, kept };
}

// ── Track B: 밀키트 수요 소싱 ──
export async function runMealkitSourcing(limit = 60): Promise<{ found: number; kept: number }> {
  const run = await prisma.sourcingRun.create({ data: { track: "MEALKIT" } });
  const raws: RawProduct[] = [];
  const detail: Record<string, number> = {};
  for (const a of productAdapters) {
    if (!a.enabled()) continue;
    try {
      const r = await a.run({ limit });
      raws.push(...r);
      detail[a.id] = r.length;
    } catch (e) {
      logError("sourcing.productAdapter", e, { id: a.id });
      detail[a.id] = -1;
    }
  }
  // 대기업 제외 + 밀키트류만 + key로 병합
  const byKey = new Map<string, RawProduct>();
  for (const r of raws) {
    if (!r.name?.trim()) continue;
    if (isBigBrand(r.brand || "") || isBigBrand(r.name)) continue;
    if (!looksLikeMealkit(r.name, r.category || "")) continue;
    const k = productKey(r.name, r.brand || "");
    const prev = byKey.get(k);
    byKey.set(k, prev ? mergeProduct(prev, r) : r);
  }
  const entries = [...byKey.entries()];

  // 리뷰 증가속도 계산용 — 기존 스냅샷 로드
  const existing = await prisma.sourcingProduct.findMany({
    where: { key: { in: entries.map(([k]) => k) } },
    select: { key: true, reviewCount: true, lastSeenAt: true },
  });
  const exMap = new Map(existing.map((e) => [e.key, e]));

  const scored = await curateProducts(
    entries.map(([k, r]) => {
      const ex = exMap.get(k);
      const days = ex ? Math.max(0.5, (Date.now() - ex.lastSeenAt.getTime()) / DAY) : 1;
      const vel = ex && r.reviewCount != null && ex.reviewCount != null ? Math.max(0, (r.reviewCount - ex.reviewCount) / days) : 0;
      return { name: r.name, brand: r.brand || "", price: r.price ?? null, reviewCount: r.reviewCount ?? null, reviewVelocity: vel, note: r.note || "" };
    }),
  );

  let kept = 0;
  for (let i = 0; i < entries.length; i++) {
    const [k, r] = entries[i];
    const s = scored[i] ?? { score: 0, reason: "" };
    const ex = exMap.get(k);
    const days = ex ? Math.max(0.5, (Date.now() - ex.lastSeenAt.getTime()) / DAY) : 1;
    const vel = ex && r.reviewCount != null && ex.reviewCount != null ? Math.max(0, (r.reviewCount - ex.reviewCount) / days) : 0;
    try {
      await prisma.sourcingProduct.upsert({
        where: { key: k },
        create: {
          key: k, source: r.source, sourceRef: r.sourceRef || "", name: r.name, brand: r.brand || "",
          category: r.category || "", price: r.price ?? null, reviewCount: r.reviewCount ?? null,
          reviewVelocity: vel, demandScore: s.score, isBigBrand: false, url: r.url || "",
          imageUrl: r.imageUrl || "", reason: s.reason,
        },
        update: {
          source: r.source, sourceRef: r.sourceRef || undefined, brand: r.brand || undefined,
          category: r.category || undefined, price: r.price ?? undefined,
          prevReviewCount: ex?.reviewCount ?? undefined, reviewCount: r.reviewCount ?? undefined,
          reviewVelocity: vel, demandScore: s.score, url: r.url || undefined,
          imageUrl: r.imageUrl || undefined, reason: s.reason, lastSeenAt: new Date(),
        },
      });
      kept++;
    } catch (e) {
      logError("sourcing.productUpsert", e, { key: k });
    }
  }
  await prisma.sourcingRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), found: raws.length, kept, detail: JSON.stringify(detail) },
  });
  return { found: raws.length, kept };
}
