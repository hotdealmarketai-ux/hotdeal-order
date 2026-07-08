// 감사 로그 기록 — 관리자의 파괴적 작업 추적. 실패해도 원 작업엔 영향 없음(로그만 남김).
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";

export type AuditInput = {
  action: string; // 예: member.delete, orders.resetAll, orders.cancelStore, invoice.void
  actorId: string;
  actorName?: string;
  targetType?: string;
  targetId?: string;
  summary?: string;
  snapshot?: unknown; // 삭제 등 복구 참고용 — JSON 직렬화해 저장(과대 방지 8KB 컷)
};

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        actorId: input.actorId,
        actorName: input.actorName ?? "",
        targetType: input.targetType ?? "",
        targetId: input.targetId ?? "",
        summary: input.summary ?? "",
        snapshot:
          input.snapshot === undefined
            ? null
            : JSON.stringify(input.snapshot).slice(0, 8000),
      },
    });
  } catch (err) {
    logError("audit.write", err, { action: input.action, actorId: input.actorId });
  }
}
