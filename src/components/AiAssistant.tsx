"use client";

import { useRef, useState } from "react";
import { askAssistantAction } from "@/app/actions/assistant";

type Msg = { role: "user" | "assistant"; content: string };

const CHIPS = [
  "발주는 어떻게 하나요?",
  "재고 담기가 뭐예요?",
  "발주를 취소하고 싶어요",
  "알림(푸시)은 어떻게 켜요?",
];

// #9 AI 도우미 — 앱 사용법을 물으면 즉답. 대화는 화면 세션 동안만 유지(기록 아님).
export function AiAssistant() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollDown = () =>
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });

  const send = async (q?: string) => {
    const text = (q ?? input).trim();
    if (!text || loading) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setLoading(true);
    scrollDown();
    const res = await askAssistantAction(next).catch(() => null);
    setLoading(false);
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content:
          res?.ok && res.text
            ? res.text
            : "지금은 답변이 어려워요. 위 '관리자 문의' 탭에서 여쭤봐 주세요.",
      },
    ]);
    scrollDown();
  };

  const Bot = ({ children }: { children: React.ReactNode }) => (
    <div className="msg msg--other msg--start">
      <div className="msg__av msg__av--bot" aria-hidden="true">
        AI
      </div>
      <div className="msg__col">
        <div className="msg__name">AI 도우미</div>
        <div className="msg__bubble">{children}</div>
      </div>
    </div>
  );

  return (
    <>
      <div className="chatbody" ref={scrollRef}>
        <Bot>안녕하세요! 오더야 사용법을 도와드리는 AI예요. 궁금한 걸 편하게 물어보세요 😊</Bot>

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg msg--mine msg--start">
              <div className="msg__col">
                <div className="msg__bubble">{m.content}</div>
              </div>
            </div>
          ) : (
            <div key={i} className="msg msg--other msg--start">
              <div className="msg__av msg__av--bot" aria-hidden="true">
                AI
              </div>
              <div className="msg__col">
                <div className="msg__bubble">{m.content}</div>
              </div>
            </div>
          ),
        )}

        {loading && (
          <div className="msg msg--other msg--start">
            <div className="msg__av msg__av--bot" aria-hidden="true">
              AI
            </div>
            <div className="msg__col">
              <div className="msg__bubble msg__typing">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        {messages.length === 0 && !loading && (
          <div className="aichips">
            {CHIPS.map((c) => (
              <button key={c} type="button" onClick={() => send(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        className="chatinput"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="chatinput__field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="사용법을 물어보세요…"
          maxLength={500}
          autoComplete="off"
        />
        <button
          className="chatinput__send"
          disabled={!input.trim() || loading}
          aria-label="전송"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 12l16-8-6 8 6 8-16-8z" fill="currentColor" />
          </svg>
        </button>
      </form>
    </>
  );
}
