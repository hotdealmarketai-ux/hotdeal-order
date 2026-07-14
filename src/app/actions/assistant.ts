"use server";

import { getCurrentUser } from "@/lib/session";
import { isMerchant } from "@/lib/constants";
import { askAssistant, type AssistantMsg } from "@/lib/assistant";

// #9 AI 도우미 — 가맹점주만. 대화 기록(history)을 받아 답변 1개 반환.
export async function askAssistantAction(
  history: AssistantMsg[],
): Promise<{ ok: boolean; text: string }> {
  const user = await getCurrentUser();
  if (!user || user.status !== "APPROVED" || !isMerchant(user.role)) {
    return { ok: false, text: "" };
  }
  const clean: AssistantMsg[] = (Array.isArray(history) ? history : [])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    )
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 2000) }))
    .slice(-12);
  if (!clean.length || clean[clean.length - 1].role !== "user") {
    return { ok: false, text: "" };
  }
  const text = await askAssistant(clean);
  return { ok: true, text };
}
