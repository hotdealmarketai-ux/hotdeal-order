// 팝빌 계좌조회(EasyFinBank) — 하나 법인계좌 '입금' 수집 + 점포 자동매칭 + 계산서 자동 입금확인.
// 서버 전용. POPBILL_* 키 없으면 명시적 에러(조용히 넘어가지 않음 — 돈이라서).
import { prisma } from "@/lib/prisma";
import { notifyMerchantInvoicePaid } from "@/lib/push";
import { kstDateOf } from "@/lib/date";

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
  return out;
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

  const candidates = await prisma.user.findMany({
    where: { payerNames: { has: dep.payerName } },
    select: { id: true },
  });
  if (candidates.length !== 1) return { storeMatched: false, invoicePaid: false };
  const userId = candidates[0].id;

  await prisma.deposit.update({
    where: { id: dep.id },
    data: { matchStatus: "AUTO", matchedUserId: userId, matchedAt: new Date() },
  });

  // 금액이 정확히 일치하는 미입금 계산서가 '딱 1장'일 때만 자동 확인
  const exact = await prisma.invoice.findMany({
    where: { userId, status: "ISSUED", total: dep.amount },
    select: { id: true },
    take: 2,
  });
  if (exact.length !== 1) return { storeMatched: true, invoicePaid: false };

  const upd = await prisma.invoice.updateMany({
    where: { id: exact[0].id, status: "ISSUED" },
    data: { status: "PAID", paidAt: dep.txAt },
  });
  if (upd.count === 1) {
    await notifyMerchantInvoicePaid(userId, exact[0].id);
    return { storeMatched: true, invoicePaid: true };
  }
  return { storeMatched: true, invoicePaid: false };
}
