// 공산품 전용 알림(서버 전용) — 공통 발송 함수(push.ts 의 sendPushToUser)만 가져다 쓴다.
// push.ts 의 공통 발송·받는 사람 판정은 손대지 않는다(채움채 라우트 등 다른 곳도 같은 함수를 씀).
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { labelDate } from "@/lib/date";
import { logError } from "@/lib/log";

// 방향 조사 로/으로 — 끝 한글 글자에 받침이 없거나 ㄹ 받침이면 '로', 그 밖의 받침이면 '으로'.
// "10월 23일 (금)" 처럼 괄호로 끝나도 마지막 한글 글자(금 → 으로)로 판정한다. 한글이 없으면 '로'.
function josaRo(word: string): string {
  for (let i = word.length - 1; i >= 0; i--) {
    const code = word.charCodeAt(i);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const jong = (code - 0xac00) % 28;
      return jong === 0 || jong === 8 ? "로" : "으로";
    }
  }
  return "로";
}

/**
 * 관리자가 공산품 출고일을 바꿈 → 그 상품을 발주한 지점에만 알림.
 * 예) '박달홍게 3kg 출고일이 10월 24일 (토)로 바뀌었어요.' / '… 10월 23일 (금)으로 바뀌었어요.'
 * 공산품이 안 보이는 지점(지점 '공산품 노출' 꺼짐)은 막다른 /reservations 대신 마이페이지로.
 */
export async function notifyFlatShipmentMoved(userIds: string[], name: string, pickupDate: string) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const when = labelDate(pickupDate);
  const title = `${name} 출고일이 ${when}${josaRo(when)} 바뀌었어요.`;
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: true, reservationEnabled: true },
    });
    await Promise.all(
      users.map((u) =>
        sendPushToUser(u.id, {
          title,
          body: "",
          url: u.role === "MERCHANT_HOTDEAL" && u.reservationEnabled !== false ? "/reservations" : "/mypage",
          type: "system",
        }),
      ),
    );
  } catch (err) {
    logError("push.notifyFlatShipmentMoved", err, { count: ids.length });
  }
}
