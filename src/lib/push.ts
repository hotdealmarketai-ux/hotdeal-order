// 웹푸시 발송(서버 전용). 비공개키 없으면 조용히 무시(앱 동작에 영향 없음).
import { prisma } from "@/lib/prisma";
import { VAPID_PUBLIC_KEY } from "@/lib/vapid";
import { logError } from "@/lib/log";
import type { Role } from "@/lib/constants";

const VAPID_SUBJECT = "mailto:hotdealmarketai@gmail.com";

export type PushPayload = { title: string; body: string; url?: string };

// web-push는 서버에서만 동적 import (클라이언트 번들 제외)
async function getWebPush() {
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("web-push");
  const webpush = mod.default ?? mod;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, priv);
  return webpush;
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const webpush = await getWebPush();
  if (!webpush) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return;
  const data = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        // 만료/해지된 구독(404/410)은 정리
        if (code === 404 || code === 410) {
          await prisma.pushSubscription
            .delete({ where: { endpoint: s.endpoint } })
            .catch(() => {});
        } else {
          logError("push.send", err, { userId, endpoint: s.endpoint, status: code });
        }
      }
    }),
  );
}

// 특정 역할의 모든 사용자에게 발송
export async function sendPushToRole(role: Role, payload: PushPayload) {
  const users = await prisma.user.findMany({
    where: { role, status: "APPROVED" },
    select: { id: true },
  });
  await Promise.all(users.map((u) => sendPushToUser(u.id, payload)));
}

// 점주(가맹점/소매)에게 '주문 완료' 알림
export async function notifyMerchantOrderPlaced(userId: string, count: number) {
  try {
    await sendPushToUser(userId, {
      title: `${count}건이 주문 완료되었습니다.`,
      body: "",
      url: "/mypage",
    });
  } catch (err) {
    console.error("[push] notifyMerchantOrderPlaced failed:", err);
  }
}

// 점주에게 '업자가 발주 확인함' 알림. vendorLabel = 받는 곳(예: 서부일광)
export async function notifyMerchantOrderConfirmed(
  userId: string,
  vendorLabel: string,
) {
  try {
    await sendPushToUser(userId, {
      title: `${vendorLabel}에서 발주를 확인하였습니다.`,
      body: "",
      url: "/mypage",
    });
  } catch (err) {
    console.error("[push] notifyMerchantOrderConfirmed failed:", err);
  }
}

// 특정 업자 역할(서부일광/조은팜/채움채/새롭)에게 새 발주 알림.
// fromStoreName = 발주를 넣은 점주(가맹점/소매) 상호.
export async function notifyVendorNewOrder(role: Role, fromStoreName: string) {
  try {
    const vendor = await prisma.user.findFirst({
      where: { role, status: "APPROVED" },
      select: { id: true },
    });
    if (!vendor) return;
    await sendPushToUser(vendor.id, {
      // 제목 한 줄만 보이도록 body는 비움(브라우저가 붙이는 출처 라벨은 제거 불가)
      title: `${fromStoreName} 님에게 발주요청이 도착했습니다.`,
      body: "",
      url: "/vendor",
    });
  } catch (err) {
    console.error("[push] notifyVendorNewOrder failed:", err);
  }
}

// 새롭(관리자)에게 '주간발주 접수' 알림
export async function notifyAdminNewWeeklyOrder(fromStoreName: string) {
  try {
    await sendPushToRole("ADMIN_SAEROP", {
      title: `${fromStoreName} 님이 주간발주를 넣었습니다.`,
      body: "",
      url: "/admin/weekly",
    });
  } catch (err) {
    logError("push.notifyAdminNewWeeklyOrder", err, {});
  }
}

// 점주에게 '관리자가 주간발주 취소' 알림
export async function notifyMerchantWeeklyCancelled(userId: string) {
  try {
    await sendPushToUser(userId, {
      title: "관리자에 의해 주간발주가 취소되었습니다.",
      body: "",
      url: "/weekly",
    });
  } catch (err) {
    logError("push.notifyMerchantWeeklyCancelled", err, { userId });
  }
}

// 점주에게 '주간발주 입금요청서 발행' 알림
export async function notifyMerchantWeeklyInvoiceIssued(userId: string) {
  try {
    await sendPushToUser(userId, {
      title: "주간발주 입금요청서가 도착했습니다.",
      body: "",
      url: "/weekly/invoices",
    });
  } catch (err) {
    logError("push.notifyMerchantWeeklyInvoiceIssued", err, { userId });
  }
}

// 점주에게 '주간발주 미입금' 안내(토요일 마감 전) — 계산서당 1회(overdueRemindedAt 멱등)
export async function notifyMerchantWeeklyInvoiceOverdue(
  userId: string,
  total: number,
) {
  try {
    await sendPushToUser(userId, {
      title: `주간발주 입금 ${total.toLocaleString("ko-KR")}원이 아직 확인되지 않았습니다. 토요일 전 입금 부탁드립니다.`,
      body: "",
      url: "/weekly/invoices",
    });
  } catch (err) {
    logError("push.notifyMerchantWeeklyInvoiceOverdue", err, { userId });
  }
}

// 점주에게 '입금요청서(계산서) 발행' 알림 — 지난 발주의 해당 날짜 입금요청서로 이동
export async function notifyMerchantInvoiceIssued(userId: string, date: string) {
  try {
    await sendPushToUser(userId, {
      title: "입금요청서가 발행되었습니다.",
      body: "",
      url: `/order/day/${date}?view=invoice`,
    });
  } catch (err) {
    console.error("[push] notifyMerchantInvoiceIssued failed:", err);
  }
}

// 점주에게 '입금 확인 완료' 알림 — 건수·금액 포함
export async function notifyMerchantInvoicePaid(
  userId: string,
  date: string,
  itemCount: number,
  total: number,
) {
  try {
    await sendPushToUser(userId, {
      title: `${itemCount}건 ${total.toLocaleString("ko-KR")}원 입금 확인이 완료되었습니다.`,
      body: "",
      url: `/order/day/${date}?view=invoice`,
    });
  } catch (err) {
    console.error("[push] notifyMerchantInvoicePaid failed:", err);
  }
}

// 점주에게 '입금 기한 안내(미입금)' 알림 — 계산서 발행 후 N일 지나도 미입금일 때
export async function notifyMerchantInvoiceOverdue(
  userId: string,
  date: string,
  total: number,
) {
  try {
    await sendPushToUser(userId, {
      title: `${total.toLocaleString("ko-KR")}원 입금이 아직 확인되지 않았습니다.`,
      body: "",
      url: `/order/day/${date}?view=invoice`,
    });
  } catch (err) {
    logError("push.notifyMerchantInvoiceOverdue", err, { userId, date });
  }
}

// 점주에게 '분할 입금 승인' 알림
export async function notifyMerchantSplitApproved(userId: string, date: string) {
  try {
    await sendPushToUser(userId, {
      title: "분할 입금이 승인되었습니다.",
      body: "",
      url: `/order/day/${date}?view=invoice`,
    });
  } catch (err) {
    logError("push.notifyMerchantSplitApproved", err, { userId, date });
  }
}

// 점주에게 '분할 입금 반려' 알림
export async function notifyMerchantSplitRejected(userId: string, date: string) {
  try {
    await sendPushToUser(userId, {
      title: "분할 입금 요청이 반려되었습니다. 전액 입금 요청드립니다.",
      body: "",
      url: `/order/day/${date}?view=invoice`,
    });
  } catch (err) {
    logError("push.notifyMerchantSplitRejected", err, { userId, date });
  }
}

// 관리자가 임의로 발주를 취소했을 때 점주에게 알림
export async function notifyMerchantOrdersCancelled(userId: string) {
  try {
    await sendPushToUser(userId, {
      title: "관리자에 의해 발주가 취소되었습니다.",
      body: "",
      url: "/order",
    });
  } catch (err) {
    console.error("[push] notifyMerchantOrdersCancelled failed:", err);
  }
}

// 발주 수정 시 받는 업체에 알림
export async function notifyVendorOrderEdited(role: Role, fromStoreName: string) {
  try {
    const vendor = await prisma.user.findFirst({
      where: { role, status: "APPROVED" },
      select: { id: true },
    });
    if (!vendor) return;
    await sendPushToUser(vendor.id, {
      title: `${fromStoreName} 님이 발주를 수정하였습니다.`,
      body: "",
      url: "/vendor",
    });
  } catch (err) {
    console.error("[push] notifyVendorOrderEdited failed:", err);
  }
}

// 점주 발주 수정 시 관리자(새롭)에게도 알림
export async function notifyAdminOrderEdited(fromStoreName: string) {
  try {
    await sendPushToRole("ADMIN_SAEROP", {
      title: `${fromStoreName} 님의 발주가 수정되었습니다. 확인해주세요.`,
      body: "",
      url: "/admin/hotdeal",
    });
  } catch (err) {
    logError("push.notifyAdminOrderEdited", err, {});
  }
}

// 점주가 '발주 취소'를 요청했을 때 관리자에게 알림
export async function notifyAdminOrderCancelRequest(fromStoreName: string) {
  try {
    await sendPushToRole("ADMIN_SAEROP", {
      title: `${fromStoreName} 님이 발주 취소를 요청했습니다.`,
      body: "",
      url: "/admin/hotdeal",
    });
  } catch (err) {
    logError("push.notifyAdminOrderCancelRequest", err, {});
  }
}

// 취소 요청을 관리자가 승인(취소 완료)했을 때 점주에게 알림
export async function notifyMerchantCancelApproved(userId: string) {
  try {
    await sendPushToUser(userId, {
      title: "취소 요청 승인이 완료되었습니다.",
      body: "",
      url: "/order",
    });
  } catch (err) {
    logError("push.notifyMerchantCancelApproved", err, { userId });
  }
}

// 취소 요청을 관리자가 반려했을 때 점주에게 알림
export async function notifyMerchantCancelRejected(userId: string) {
  try {
    await sendPushToUser(userId, {
      title: "발주 취소 요청이 반려되었습니다.",
      body: "",
      url: "/order",
    });
  } catch (err) {
    logError("push.notifyMerchantCancelRejected", err, { userId });
  }
}
