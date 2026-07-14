"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  chatBootstrap,
  chatUnread,
  merchantLoadChat,
  adminLoadThreads,
  adminLoadThread,
  sendChat,
  clearChat,
  type ChatRole,
  type ChatMsg,
  type ChatThreadItem,
} from "@/app/actions/chat";

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Seoul",
  });

// #9 1:1 문의 채팅 — 우하단 플로팅 버튼 + 팝업. 가맹점주=관리자와 1:1, 관리자=지점 목록(DM식).
export function ChatWidget() {
  const [role, setRole] = useState<ChatRole | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "thread">("thread");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("");
  const [threads, setThreads] = useState<ChatThreadItem[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingChatParam = useRef<string | null>(null);

  // 부트스트랩 + 푸시로 들어온 ?chat= 파라미터 감지
  useEffect(() => {
    (async () => {
      const b = await chatBootstrap().catch(() => null);
      if (!b) return;
      setRole(b.role);
      setUnread(b.unread);
      try {
        const p = new URLSearchParams(window.location.search).get("chat");
        if (p) pendingChatParam.current = p;
      } catch {
        /* noop */
      }
    })();
  }, []);

  // 닫혀있을 때 미읽음 폴링
  useEffect(() => {
    if (!role || open) return;
    const id = setInterval(async () => {
      const n = await chatUnread().catch(() => null);
      if (typeof n === "number") setUnread(n);
    }, 12000);
    return () => clearInterval(id);
  }, [role, open]);

  const scrollDown = () => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const loadThreadMessages = useCallback(
    async (tid: string, isAdmin: boolean) => {
      const res = isAdmin ? await adminLoadThread(tid) : await merchantLoadChat();
      if (!res) {
        // 잘못된/사라진 스레드(예: 유효하지 않은 ?chat=) → 관리자는 목록으로 복귀
        if (isAdmin) {
          setView("list");
          setThreadId(null);
          const l = await adminLoadThreads();
          if (l) setThreads(l);
        }
        return;
      }
      const sn = (res as { storeName?: string }).storeName;
      if (sn) setStoreName(sn);
      setThreadId(res.threadId);
      setMessages(res.messages);
      setUnread(await chatUnread().catch(() => 0));
      scrollDown();
    },
    [],
  );

  const openMerchantChat = useCallback(async () => {
    setView("thread");
    const res = await merchantLoadChat();
    if (res) {
      setThreadId(res.threadId);
      setMessages(res.messages);
      setUnread(await chatUnread().catch(() => 0));
      scrollDown();
    }
  }, []);

  const openAdminList = useCallback(async () => {
    setView("list");
    setThreadId(null);
    const list = await adminLoadThreads();
    if (list) setThreads(list);
  }, []);

  const openPanel = useCallback(async () => {
    setOpen(true);
    setMenuOpen(false);
    if (role === "merchant") await openMerchantChat();
    else await openAdminList();
  }, [role, openMerchantChat, openAdminList]);

  // 푸시 ?chat= 로 자동 열기
  useEffect(() => {
    if (!role || open || !pendingChatParam.current) return;
    const p = pendingChatParam.current;
    pendingChatParam.current = null;
    try {
      // URL에서 ?chat= 제거(뒤로가기/새로고침 시 재오픈 방지)
      window.history.replaceState({}, "", window.location.pathname);
    } catch {
      /* noop */
    }
    (async () => {
      setOpen(true);
      if (role === "merchant") {
        await openMerchantChat();
      } else {
        setView("thread");
        await loadThreadMessages(p, true);
      }
    })();
  }, [role, open, openMerchantChat, loadThreadMessages]);

  // 대화 열려있는 동안 메시지 폴링
  useEffect(() => {
    if (!open) return;
    if (role === "merchant" || (role === "admin" && view === "thread" && threadId)) {
      const id = setInterval(() => {
        if (role === "merchant") openMerchantChat();
        else if (threadId) loadThreadMessages(threadId, true);
      }, 3500);
      return () => clearInterval(id);
    }
    if (role === "admin" && view === "list") {
      const id = setInterval(() => openAdminList(), 5000);
      return () => clearInterval(id);
    }
  }, [open, role, view, threadId, openMerchantChat, loadThreadMessages, openAdminList]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (role === "admin" && !threadId) return; // 대화 미선택 시 전송 금지
    setInput("");
    setErr("");
    const tmpId = `tmp-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: tmpId, mine: true, body: text, at: new Date().toISOString(), readAt: null },
    ]);
    scrollDown();
    const res = await sendChat(text, role === "admin" ? threadId ?? undefined : undefined);
    if (!res?.ok) {
      // 실패 → 낙관적 버블 제거 + 입력 복원(문구 유실 방지)
      setMessages((m) => m.filter((x) => x.id !== tmpId));
      setInput(text);
      if (res?.error) setErr(res.error);
      return;
    }
    // 성공: 낙관적 버블 유지 → 다음 폴링(≤3.5s)이 서버 메시지로 조용히 정합(깜빡임 방지)
  };

  const doClear = async () => {
    if (!threadId) return;
    setMenuOpen(false);
    await clearChat(threadId);
    setMessages([]);
  };

  if (!role) return null;

  const lastMine = [...messages].reverse().find((m) => m.mine);

  return (
    <>
      {!open && (
        <button className="chatfab" onClick={openPanel} aria-label="문의 채팅 열기">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7A2.5 2.5 0 0 1 17.5 15H9l-4 3.5V15H6.5A2.5 2.5 0 0 1 4 12.5z"
              fill="currentColor"
            />
          </svg>
          {unread > 0 && <span className="chatfab__badge">{unread > 99 ? "99+" : unread}</span>}
        </button>
      )}

      {open && (
        <div className="chatpop" role="dialog" aria-modal="true">
          <div className="chatpop__head">
            {role === "admin" && view === "thread" ? (
              <button className="chatpop__back" onClick={openAdminList} aria-label="목록으로">
                ‹
              </button>
            ) : (
              <span className="chatpop__ico" aria-hidden="true">💬</span>
            )}
            <div className="chatpop__title">
              {role === "admin"
                ? view === "list"
                  ? "문의 채팅"
                  : storeName
                : "새롭 관리자 문의"}
            </div>
            <div className="chatpop__actions">
              {view === "thread" && (
                <button
                  className="chatpop__more"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-label="메뉴"
                >
                  ⋯
                </button>
              )}
              <button className="chatpop__close" onClick={() => setOpen(false)} aria-label="닫기">
                ✕
              </button>
              {menuOpen && (
                <div className="chatmenu">
                  <button onClick={doClear}>내 화면에서 대화 비우기</button>
                </div>
              )}
            </div>
          </div>

          {/* 관리자 목록 */}
          {role === "admin" && view === "list" ? (
            <div className="chatlist" ref={scrollRef}>
              {threads.length === 0 ? (
                <div className="chatempty">아직 문의가 없어요.</div>
              ) : (
                threads.map((t) => (
                  <button
                    key={t.threadId}
                    className="chatlist__item"
                    onClick={() => {
                      setView("thread");
                      loadThreadMessages(t.threadId, true);
                    }}
                  >
                    <div className="chatlist__av" aria-hidden="true">
                      {t.storeName.slice(0, 1)}
                    </div>
                    <div className="chatlist__main">
                      <div className="chatlist__top">
                        <span className="chatlist__name">{t.storeName}</span>
                        <span className="chatlist__time">{fmtTime(t.lastAt)}</span>
                      </div>
                      <div className="chatlist__last">{t.last}</div>
                    </div>
                    {t.unread > 0 && <span className="chatlist__badge">{t.unread}</span>}
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="chatbody" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="chatempty">
                    {role === "merchant"
                      ? "궁금한 점을 편하게 남겨 주세요."
                      : "메시지를 보내 대화를 시작하세요."}
                  </div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`msg ${m.mine ? "msg--mine" : "msg--other"}`}>
                      <div className="msg__bubble">{m.body}</div>
                      <div className="msg__meta">
                        {fmtTime(m.at)}
                        {m.mine && m === lastMine && (
                          <span className="msg__read">
                            {m.readAt ? ` · 읽음 ${fmtTime(m.readAt)}` : " · 안읽음"}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {err && <div className="chaterr">{err}</div>}
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
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (err) setErr("");
                  }}
                  placeholder="메시지 입력…"
                  maxLength={2000}
                  autoComplete="off"
                />
                <button className="chatinput__send" disabled={!input.trim()} aria-label="전송">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 12l16-8-6 8 6 8-16-8z" fill="currentColor" />
                  </svg>
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
