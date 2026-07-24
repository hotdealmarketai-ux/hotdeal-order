// 팝빌 계좌조회(EasyFinBank) — 하나 법인계좌 '입금' 수집 + 점포 자동매칭 + 계산서 자동 입금확인.
// 서버 전용. POPBILL_* 키 없으면 명시적 에러(조용히 넘어가지 않음 — 돈이라서).
import { prisma } from "@/lib/prisma";
import { notifyMerchantInvoicePaid, sendPushToRole } from "@/lib/push";
import { kstDateOf } from "@/lib/date";
import { logError } from "@/lib/log";
import { clearWeeklyUnlockIfSettled } from "@/lib/weekly";

const DAY_MS = 24 * 60 * 60 * 1000;

// 팝빌 원장 거래 레코드(입금분만 사용)
type PopbillTx = {
  tid: string; // 거래 고유번호(중복 수집 방지 키)
  trdt: string; // 거래일시 yyyyMMddHHmmss (KST)
  accIn: string; // 입금액
  accOut: string; // 출금액
  balance: string; // 거래후 잔액
  remark1: string;
  remark2: string;
  remark3: string;
  remark4: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let configured = false;
async function getService(): Promise<any> {
  const LinkID = process.env.POPBILL_LINK_ID;
  const SecretKey = process.env.POPBILL_SECRET_KEY;
  if (!LinkID || !SecretKey) throw new Error("POPBILL_LINK_ID/SECRET_KEY 미설정");
  const mod: any = await import("popbill");
  const popbill = mod.default ?? mod;
  if (!configured) {
    popbill.config({
      LinkID,
      SecretKey,
      IsTest: process.env.POPBILL_IS_TEST !== "false",
      IPRestrictOnOff: true,
      UseStaticIP: false,
      UseLocalTimeYN: true,
      defaultErrorHandler: () => {},
    });
    configured = true;
  }
  return popbill.EasyFinBankService();
}

// 팝빌 콜백 API → Promise (전체 인자형으로 호출해 오버로드 모호성 제거)
function pListBankAccount(svc: any, corpNum: string): Promise<any[]> {
  return new Promise((res, rej) => svc.listBankAccount(corpNum, "", res, rej));
}
function pRequestJob(
  svc: any, corpNum: string, bankCode: string, account: string, s: string, e: string,
): Promise<string> {
  return new Promise((res, rej) => svc.requestJob(corpNum, bankCode, account, s, e, "", res, rej));
}
function pGetJobState(svc: any, corpNum: string, jobId: string): Promise<any> {
  return new Promise((res, rej) => svc.getJobState(corpNum, jobId, "", res, rej));
}
function pSearch(
  svc: any, corpNum: string, jobId: string, page: number,
): Promise<{ total: number; perPage: number; pageNum: number; list: PopbillTx[] }> {
  return new Promise((res, rej) =>
    svc.search(corpNum, jobId, ["I"], "", page, 1000, "D", "", res, rej),
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// "yyyyMMddHHmmss"(KST) → Date
function parseTrdt(trdt: string): Date {
  const m = String(trdt ?? "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return new Date();
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`);
}

function yyyymmdd(d: Date): string {
  return kstDateOf(d).replace(/-/g, "");
}

export type CollectResult = {
  accounts: number;
  scanned: number; // 조회된 입금 거래 수
  created: number; // 새로 저장된 입금
  matchedStores: number; // 입금자명으로 점포 매칭된 건
  paidInvoices: number; // 금액 일치로 자동 입금확인된 계산서 수
  errors: string[];
};

// 최근 N일 입금 수집 → Deposit 저장(tid 중복 방지) → 자동매칭
export async function collectDeposits(days = 3): Promise<CollectResult> {
  const corpNum = process.env.POPBILL_CORP_NUM;
  if (!corpNum) throw new Error("POPBILL_CORP_NUM 미설정");
  const svc = await getService();

  const out: CollectResult = {
    accounts: 0, scanned: 0, created: 0, matchedStores: 0, paidInvoices: 0, errors: [],
  };

  const accounts = await pListBankAccount(svc, corpNum).catch((e) => {
    throw new Error(`계좌 목록 조회 실패: ${e?.message ?? e}`);
  });
  const usable = (accounts ?? []).filter((a) => a?.state === 1); // 1 = 정상 사용중
  out.accounts = usable.length;
  if (usable.length === 0) return out;

  const now = new Date();
  const sdate = yyyymmdd(new Date(now.getTime() - days * DAY_MS));
  const edate = yyyymmdd(now);

  for (const acct of usable) {
    try {
      const jobId = await pRequestJob(svc, corpNum, acct.bankCode, acct.accountNumber, sdate, edate);
      // 수집 완료 대기(최대 ~30초)
      let done = false;
      for (let i = 0; i < 20; i++) {
        await sleep(1500);
        const st = await pGetJobState(svc, corpNum, jobId);
        if (st?.jobState === 3) {
          if (st.errorCode !== 1) {
            throw new Error(`수집 실패(errorCode ${st.errorCode}) ${st.errorReason ?? ""}`);
          }
          done = true;
          break;
        }
      }
      if (!done) throw new Error("수집 대기 시간 초과");

      // 입금 거래 페이지 순회
      for (let page = 1; page <= 10; page++) {
        const res = await pSearch(svc, corpNum, jobId, page);
        const list = res?.list ?? [];
        out.scanned += list.length;
        for (const tx of list) {
          const amount = parseInt(String(tx.accIn ?? "0").replace(/[^0-9]/g, ""), 10);
          if (!Number.isFinite(amount) || amount <= 0) continue;
          const payerName = String(tx.remark1 ?? "").trim();
          const memo = [tx.remark1, tx.remark2, tx.remark3, tx.remark4]
            .map((s) => String(s ?? "").trim())
            .filter(Boolean)
            .join(" ");
          const balance = parseInt(String(tx.balance ?? "").replace(/[^0-9]/g, ""), 10);
          try {
            const dep = await prisma.deposit.create({
              data: {
                bankTid: String(tx.tid),
                txAt: parseTrdt(tx.trdt),
                amount,
                payerName,
                memo,
                balanceAfter: Number.isFinite(balance) ? balance : null,
              },
            });
            out.created += 1;
            const r = await autoMatchDeposit(dep.id);
            if (r.storeMatched) out.matchedStores += 1;
            if (r.invoicePaid) out.paidInvoices += 1;
          } catch (err) {
            if ((err as { code?: string })?.code === "P2002") continue; // 이미 수집된 거래
            throw err;
          }
        }
        if (list.length < 1000) break;
      }
    } catch (err) {
      out.errors.push(`${acct.accountNumber}: ${(err as Error)?.message ?? err}`);
    }
  }
  // 최신 동기화 시각 기록(관리자 화면 표시용)
  await prisma.appMeta
    .upsert({
      where: { key: "bank_sync" },
      create: { key: "bank_sync", syncedAt: new Date() },
      update: { syncedAt: new Date() },
    })
    .catch(() => {});
  return out;
}

// 팝빌 계좌 최신 동기화 시각(없으면 null)
export async function lastBankSyncAt(): Promise<Date | null> {
  const m = await prisma.appMeta.findUnique({ where: { key: "bank_sync" } });
  return m?.syncedAt ?? null;
}

// 입금 1건 자동매칭 — 입금자명이 정확히 한 점포의 payerNames와 일치할 때만.
// 그 점포의 '입금 대기(ISSUED)' 계산서 중 금액이 정확히 일치하는 게 1장이면 자동 입금확인.
// 조금이라도 모호하면(0곳/2곳 이상, 금액 불일치/중복) 사람 확인으로 남긴다.
export async function autoMatchDeposit(
  depositId: string,
): Promise<{ storeMatched: boolean; invoicePaid: boolean }> {
  const dep = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!dep || dep.matchStatus !== "UNMATCHED" || !dep.payerName) {
    return { storeMatched: false, invoicePaid: false };
  }

  // 정산 대상(승인된 가맹/소매)만 후보로 — 미승인·타 역할 계정의 입금자명 위조 매칭 방지
  const candidates = await prisma.user.findMany({
    where: {
      payerNames: { has: dep.payerName },
      status: "APPROVED",
      role: { in: ["MERCHANT_HOTDEAL", "MERCHANT_SEOBU"] },
    },
    select: { id: true },
  });
  if (candidates.length !== 1) return { storeMatched: false, invoicePaid: false };
  const userId = candidates[0].id;

  await prisma.deposit.update({
    where: { id: dep.id },
    data: { matchStatus: "AUTO", matchedUserId: userId, matchedAt: new Date() },
  });

  const paidId = await tryAutoPayInvoice(userId, dep.amount, dep.txAt);
  if (paidId) {
    // 이 입금을 그 계산서 대금으로 소진 처리(다른 계산서 차액에 중복 계산 방지)
    await prisma.deposit.update({
      where: { id: dep.id },
      data: { appliedInvoiceId: paidId },
    });
  } else {
    // 자동확정 대상이 없으면, 관리자가 이미 '수동 입금확인'해 둔 계산서의 합성입금을
    // 이 실입금으로 대체(이중계상 방지). 정확일치 없으면 그대로 미소진으로 남긴다.
    await replaceManualPlaceholderWithReal(userId, dep.id);
  }
  return { storeMatched: true, invoicePaid: !!paidId };
}

// 금액이 정확히 일치하는 '입금 대기(ISSUED)' 계산서가 딱 1장일 때만 자동 입금확인.
// 귀속 정합성 게이트: 입금 시점 이전에 '발행'된 것 + 분할요청 아닌 것만. 애매하면 사람 확인.
// 성공 시 확정된 invoiceId 반환, 아니면 null. (자동매칭 공용)
export async function tryAutoPayInvoice(
  userId: string,
  amount: number,
  paidAt: Date,
): Promise<string | null> {
  const exact = await prisma.invoice.findMany({
    where: {
      userId,
      status: "ISSUED",
      total: amount,
      splitRequested: false,
      issuedAt: { lte: paidAt },
    },
    select: { id: true, date: true, total: true, _count: { select: { items: true } } },
    take: 2,
  });
  if (exact.length !== 1) return null;
  const inv = exact[0];
  const upd = await prisma.invoice.updateMany({
    where: { id: inv.id, status: "ISSUED" }, // manualPaid(PAID)는 status가 이미 PAID라 여기 안 걸림
    data: { status: "PAID", paidAt },
  });
  if (upd.count === 1) {
    await notifyMerchantInvoicePaid(userId, inv.date, inv._count.items, inv.total);
    // 결제된 계산서가 일일이든 주간이든, 해당 종류의 미수가 모두 없어지면 그 잠금해제를 원복.
    await clearOrderUnlockIfSettled(userId);
    await clearWeeklyUnlockIfSettled(userId);
    return inv.id;
  }
  return null;
}

// 관리자가 실입금 도착 전에 '수동 입금확인'하면 합성입금(bankTid=manual-<invId>)이 생긴다.
// 뒤늦게 진짜 입금이 수집되면, 금액이 딱 맞는 그 합성입금을 실입금으로 '대체'(합성 삭제 + 실입금 귀속)해
// 통장 이중계상(합성+실입금 동시 존재)을 막는다. 정확일치일 때만 동작(보수적 — 버그#10).
export async function replaceManualPlaceholderWithReal(
  userId: string,
  depositId: string,
): Promise<boolean> {
  const dep = await prisma.deposit.findUnique({
    where: { id: depositId },
    select: { id: true, amount: true, appliedInvoiceId: true },
  });
  if (!dep || dep.appliedInvoiceId) return false;
  // 이 점포의 수동확정(PAID·manualPaid) 계산서 중 금액이 딱 맞는 것.
  const inv = await prisma.invoice.findFirst({
    where: { userId, status: "PAID", manualPaid: true, total: dep.amount },
    orderBy: { paidAt: "desc" },
    select: { id: true },
  });
  if (!inv) return false;
  const synth = await prisma.deposit.findUnique({
    where: { bankTid: `manual-${inv.id}` },
    select: { id: true, amount: true },
  });
  if (!synth) return false;
  // 합성입금이 '전액 합성'(=계산서 total, 즉 실입금과 동일)일 때만 대체(부분충당은 손대지 않음).
  // 금액이 다르면 자동으로 손대지 않는다 — 차액(부분입금/과입금)을 코드가 임의로 덮으면 안 되므로.
  // 다만 이대로 두면 합성 + 실입금이 통장에 '둘 다' 남아 조용히 이중계상되니, 관리자에게 알린다.
  if (synth.amount !== dep.amount) {
    logError("bank.manualPlaceholderMismatch", new Error("합성입금과 실입금 금액 불일치"), {
      userId,
      invoiceId: inv.id,
      synthAmount: synth.amount,
      realAmount: dep.amount,
    });
    await sendPushToRole("ADMIN_SAEROP", {
      title: "입금 확인이 필요합니다.",
      body: `수동 확인한 금액(${synth.amount.toLocaleString("ko-KR")}원)과 실제 입금(${dep.amount.toLocaleString("ko-KR")}원)이 달라요. 입출금 내역을 정리해 주세요.`,
      url: "/admin/deposits",
    }).catch(() => {});
    return false;
  }
  await prisma.$transaction([
    prisma.deposit.delete({ where: { id: synth.id } }),
    prisma.deposit.update({
      where: { id: dep.id },
      data: { appliedInvoiceId: inv.id },
    }),
  ]);
  return true;
}

// 미수(ISSUED)가 모두 정산되면 관리자 임의 잠금해제(orderUnlock)를 자동으로 원복 —
// 해제가 영구 무력화되지 않게.
export async function clearOrderUnlockIfSettled(userId: string) {
  const remaining = await prisma.invoice.count({
    where: { userId, status: "ISSUED" },
  });
  if (remaining === 0) {
    await prisma.user.updateMany({
      where: { id: userId, orderUnlock: true },
      data: { orderUnlock: false, orderUnlockAt: null },
    });
  }
}
