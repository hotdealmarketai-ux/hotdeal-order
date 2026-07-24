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
import { AiAssistant } from "@/components/AiAssistant";

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
  // 가맹점 전용: AI 도우미 / 관리자 문의 모드
  const [mMode, setMMode] = useState<"ai" | "admin">("ai");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("");
  const [threads, setThreads] = useState<ChatThreadItem[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingChatParam = useRef<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 플로팅 버튼 위치(꾹 눌러 드래그) + 스침 방지
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ active: false, moved: false, longPressed: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const livePos = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("chatFabPos");
      if (!raw) return;
      const p = JSON.parse(raw);
      if (typeof p?.x === "number" && typeof p?.y === "number") {
        const s = 56, mg = 6;
        setFabPos({
          x: Math.max(mg, Math.min(p.x, window.innerWidth - s - mg)),
          y: Math.max(mg, Math.min(p.y, window.innerHeight - s - mg)),
        });
      }
    } catch {
      /* noop */
    }
  }, []);

  // 플로팅 버튼으로 모이는 닫힘 애니메이션 후 실제 언마운트
  const closePanel = useCallback(() => {
    setMenuOpen(false);
    setClosing(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 230);
  }, []);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

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

  // 지금 맨 아래(근처)를 보고 있는가 — 폴링 갱신 때 위로 올려 읽는 중이면 끌어내리지 않기 위해.
  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadThreadMessages = useCallback(
    async (tid: string, isAdmin: boolean, fromPoll = false) => {
      // 폴링 갱신이면 '이미 아래에 있을 때만' 따라 내려간다(위치는 갱신 전에 판단).
      const stick = !fromPoll || isNearBottom();
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
      if (stick) scrollDown();
    },
    [],
  );

  const openMerchantChat = useCallback(async (fromPoll = false) => {
    setView("thread");
    // 폴링 갱신이면 '이미 아래에 있을 때만' 따라 내려간다(위로 올려 읽는 중이면 유지).
    const stick = !fromPoll || isNearBottom();
    const res = await merchantLoadChat();
    if (res) {
      setThreadId(res.threadId);
      setMessages(res.messages);
      setUnread(await chatUnread().catch(() => 0));
      if (stick) scrollDown();
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
    // 가맹점: 기본 'AI 도우미'(클라이언트). 관리자 문의 탭일 때만 사람 채팅 로드.
    // 단, 안 읽은 관리자 메시지가 있으면 '관리자 문의' 탭으로 열어 답장이 바로 보이게 한다
    // (배지를 눌렀는데 AI 탭이 열려 "알림은 떴는데 아무것도 없다"가 되던 문제).
    if (role === "merchant") {
      if (unread > 0) {
        setMMode("admin");
        await openMerchantChat();
      } else if (mMode === "admin") {
        await openMerchantChat();
      }
    } else {
      await openAdminList();
    }
  }, [role, mMode, unread, openMerchantChat, openAdminList]);

  // 가맹점 탭 전환(AI ↔ 관리자 문의)
  const switchMMode = useCallback(
    async (mode: "ai" | "admin") => {
      setMMode(mode);
      setMenuOpen(false);
      setErr("");
      if (mode === "admin") await openMerchantChat();
    },
    [openMerchantChat],
  );

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
        // 푸시로 들어온 관리자 채팅 → '관리자 문의' 탭으로 전환
        setMMode("admin");
        await openMerchantChat();
      } else {
        setView("thread");
        await loadThreadMessages(p, true);
      }
    })();
  }, [role, open, openMerchantChat, loadThreadMessages]);

  // 대화 열려있는 동안 메시지 폴링 (AI 도우미 탭은 폴링 없음)
  useEffect(() => {
    if (!open) return;
    const merchantAdmin = role === "merchant" && mMode === "admin";
    if (merchantAdmin || (role === "admin" && view === "thread" && threadId)) {
      const id = setInterval(() => {
        // fromPoll=true → 위로 올려 읽는 중이면 스크롤 위치를 유지한다.
        if (merchantAdmin) openMerchantChat(true);
        else if (threadId) loadThreadMessages(threadId, true, true);
      }, 3500);
      return () => clearInterval(id);
    }
    if (role === "admin" && view === "list") {
      const id = setInterval(() => openAdminList(), 5000);
      return () => clearInterval(id);
    }
  }, [open, role, mMode, view, threadId, openMerchantChat, loadThreadMessages, openAdminList]);

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

  const clampPos = (x: number, y: number) => {
    const s = 56, mg = 6;
    return {
      x: Math.max(mg, Math.min(x, window.innerWidth - s - mg)),
      y: Math.max(mg, Math.min(y, window.innerHeight - s - mg)),
    };
  };
  const onFabDown = (e: React.PointerEvent) => {
    suppressClick.current = false;
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
    const r = el.getBoundingClientRect();
    drag.current = { active: true, moved: false, longPressed: false, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
    livePos.current = { x: r.left, y: r.top };
    if (lpTimer.current) clearTimeout(lpTimer.current);
    lpTimer.current = setTimeout(() => {
      // 꾹 누름 → 드래그 모드(이후 클릭은 열지 않음)
      drag.current.longPressed = true;
      suppressClick.current = true;
      setDragging(true);
      setFabPos(clampPos(drag.current.ox, drag.current.oy));
      try { navigator.vibrate?.(15); } catch { /* noop */ }
    }, 320);
  };
  const onFabMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 9) {
      d.moved = true;
      suppressClick.current = true; // 스침/스크롤은 열지 않음
    }
    if (d.longPressed) {
      const p = clampPos(d.ox + dx, d.oy + dy);
      livePos.current = p;
      setFabPos(p);
    } else if (d.moved && lpTimer.current) {
      // 길게 누르기 전에 움직였으면 = 스크롤/스침 → 드래그도 취소
      clearTimeout(lpTimer.current);
      lpTimer.current = null;
    }
  };
  const onFabUp = () => {
    const d = drag.current;
    d.active = false;
    if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
    if (d.longPressed) {
      setDragging(false);
      if (livePos.current) {
        try { localStorage.setItem("chatFabPos", JSON.stringify(livePos.current)); } catch { /* noop */ }
      }
    }
  };
  const onFabClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    openPanel();
  };

  if (!role) return null;

  const lastMine = [...messages].reverse().find((m) => m.mine);
  // 상대방 이름/아바타 — 가맹점 화면에선 '관리자', 관리자 화면에선 지점명
  const otherName = role === "admin" ? storeName || "가맹점" : "관리자";

  return (
    <>
      {!open && (
        <button
          className={`chatfab${dragging ? " chatfab--drag" : ""}`}
          style={
            fabPos
              ? { left: fabPos.x, top: fabPos.y, right: "auto", bottom: "auto" }
              : undefined
          }
          onPointerDown={onFabDown}
          onPointerMove={onFabMove}
          onPointerUp={onFabUp}
          onPointerCancel={onFabUp}
          onClick={onFabClick}
          aria-label="문의 채팅 열기 (길게 눌러 위치 이동)"
        >
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
        <div
          className={`chatpop${closing ? " chatpop--closing" : ""}`}
          role="dialog"
          aria-modal="true"
        >
          <div className="chatpop__head">
            {role === "admin" && view === "thread" && (
              <button className="chatpop__back" onClick={openAdminList} aria-label="목록으로">
                ‹
              </button>
            )}
            <div className="chatpop__title">
              {role === "admin"
                ? view === "list"
                  ? "메세지"
                  : storeName
                : mMode === "ai"
                  ? "AI 도우미"
                  : "관리자와 1:1 채팅하기"}
            </div>
            <div className="chatpop__actions">
              {view === "thread" && !(role === "merchant" && mMode === "ai") && (
                <button
                  className="chatpop__more"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-label="메뉴"
                >
                  ⋯
                </button>
              )}
              <button className="chatpop__close" onClick={closePanel} aria-label="닫기">
                ✕
              </button>
              {menuOpen && (
                <div className="chatmenu">
                  <button onClick={doClear}>내 화면에서 대화 비우기</button>
                </div>
              )}
            </div>
          </div>

          {/* 가맹점: AI 도우미 ↔ 관리자 문의 탭 */}
          {role === "merchant" && (
            <div className="chattabs" role="tablist">
              <button
                role="tab"
                aria-selected={mMode === "ai"}
                className={mMode === "ai" ? "is-active" : ""}
                onClick={() => switchMMode("ai")}
              >
                AI 도우미
              </button>
              <button
                role="tab"
                aria-selected={mMode === "admin"}
                className={mMode === "admin" ? "is-active" : ""}
                onClick={() => switchMMode("admin")}
              >
                관리자 문의
              </button>
            </div>
          )}

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
          ) : role === "merchant" && mMode === "ai" ? (
            <AiAssistant />
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
                  messages.map((m, i) => {
                    const prev = messages[i - 1];
                    const startGroup = !prev || prev.mine !== m.mine;
                    return (
                      <div
                        key={m.id}
                        className={`msg ${m.mine ? "msg--mine" : "msg--other"}${
                          startGroup ? " msg--start" : ""
                        }`}
                      >
                        {!m.mine && (
                          <div className="msg__av" aria-hidden="true">
                            {startGroup ? otherName.slice(0, 1) : ""}
                          </div>
                        )}
                        <div className="msg__col">
                          {!m.mine && startGroup && (
                            <div className="msg__name">{otherName}</div>
                          )}
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
                      </div>
                    );
                  })
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
