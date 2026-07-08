// 미매칭 입금 → 점포 '자동 제안'. 관리자가 한 번에 매칭할 수 있게 후보를 계산.
// 안전 원칙: '유일하게' 특정되는 경우만 제안(애매하면 제안 안 함 → 오매칭 방지).
import { prisma } from "@/lib/prisma";

export type DepositSuggestion = {
  userId: string;
  storeName: string;
  reason: string;
  remember: boolean; // 이 제안으로 매칭 시 입금자명 학습 여부(이름 기반만 true)
};

const norm = (s: string) => (s ?? "").replace(/\s+/g, "").toLowerCase();

export async function suggestStoresForDeposits(
  deposits: { id: string; payerName: string; amount: number }[],
): Promise<Map<string, DepositSuggestion>> {
  const out = new Map<string, DepositSuggestion>();
  if (deposits.length === 0) return out;

  const [merchants, issued] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: { in: ["MERCHANT_HOTDEAL", "MERCHANT_SEOBU"] },
        status: "APPROVED",
      },
      select: { id: true, storeName: true, payerNames: true },
    }),
    prisma.invoice.findMany({
      where: { status: "ISSUED", splitRequested: false },
      select: { userId: true, total: true },
    }),
  ]);

  const nameById = new Map(merchants.map((m) => [m.id, m.storeName]));
  // 금액 → 그 금액의 미입금(ISSUED) 계산서를 가진 점포 집합
  const amountToUsers = new Map<number, Set<string>>();
  for (const inv of issued) {
    if (!amountToUsers.has(inv.total)) amountToUsers.set(inv.total, new Set());
    amountToUsers.get(inv.total)!.add(inv.userId);
  }

  for (const d of deposits) {
    const dp = norm(d.payerName);

    // 1) 입금자명 부분 일치(등록 입금자명 ⊂ 적요, 또는 반대) — 후보 유일할 때만
    const nameCandidates = new Set<string>();
    if (dp) {
      for (const m of merchants) {
        if (
          m.payerNames.some((p) => {
            const np = norm(p);
            return np.length >= 3 && (dp.includes(np) || np.includes(dp));
          })
        ) {
          nameCandidates.add(m.id);
        }
      }
    }

    // 2) 미입금 금액 일치 — 그 금액의 미입금 계산서를 가진 점포 집합
    const amtUsers = amountToUsers.get(d.amount);

    // 결정: 이름 유일(+금액도 맞으면 확신) > 금액 유일
    let pick: { userId: string; reason: string; remember: boolean } | null = null;
    if (nameCandidates.size === 1) {
      const uid = [...nameCandidates][0];
      // 이름 기반 제안만 입금자명 학습 허용
      pick = {
        userId: uid,
        reason: amtUsers?.has(uid) ? "입금자명·금액 일치" : "입금자명 유사",
        remember: true,
      };
    } else if (amtUsers && amtUsers.size === 1) {
      // 금액만 우연히 일치 → 입금자명은 학습하지 않음(오토매칭 오염 방지)
      pick = {
        userId: [...amtUsers][0],
        reason: `미입금 ${d.amount.toLocaleString("ko-KR")}원 일치`,
        remember: false,
      };
    }

    if (pick) {
      const storeName = nameById.get(pick.userId);
      if (storeName) {
        out.set(d.id, {
          userId: pick.userId,
          storeName,
          reason: pick.reason,
          remember: pick.remember,
        });
      }
    }
  }
  return out;
}
