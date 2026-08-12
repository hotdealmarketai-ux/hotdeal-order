"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { messengerUnreadAction, toggleMessengerFavoriteAction } from "@/app/actions/messenger";
import { MessengerLogoutButton } from "@/components/messenger/MessengerLogoutButton";
import { ChatPane, type ChatTool } from "@/components/messenger/ChatPane";
import { TasksPane } from "@/components/messenger/TasksPane";
import { MyTasksPane } from "@/components/messenger/MyTasksPane";
import { CalendarPane } from "@/components/messenger/CalendarPane";
import { AddTaskButton } from "@/components/messenger/AddTaskButton";
import { MessengerPushBanner } from "@/components/messenger/MessengerPushBanner";

type Channel = { id: string; name: string; favorite: boolean; groupId: string | null };
type Group = { id: string; name: string };
type Member = { id: string; name: string; active: boolean };
type View = "home" | "chat" | "calendar" | "mytasks";

export function MessengerWorkspace({
  me,
  channels,
  members,
  groups,
}: {
  me: { id: string; name: string };
  channels: Channel[];
  members: Member[];
  groups: Group[];
}) {
  const [view, setView] = useState<View>("home");
  const [chans, setChans] = useState<Channel[]>(channels);
  const [active, setActive] = useState<string>(channels[0]?.id ?? "");
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [sideOpen, setSideOpen] = useState(false);
  const [jumpMsg, setJumpMsg] = useState<string | null>(null);
  const [tool, setTool] = useState<ChatTool>(null);
  const [chMenu, setChMenu] = useState<{ id: string; favorite: boolean; x: number; y: number } | null>(null);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const lpStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const u = await messengerUnreadAction();
      if (alive) setUnread(u);
    };
    run();
    const t = setInterval(run, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [view, active]);

  // 푸시 알림 클릭 딥링크(?ch=채널 / ?view=mytasks) 처리 후 URL 정리.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const ch = sp.get("ch");
    const v = sp.get("view");
    if (ch && channels.some((c) => c.id === ch)) {
      setActive(ch);
      setView("chat");
    } else if (v === "mytasks") {
      setView("mytasks");
    }
    if (ch || v) window.history.replaceState({}, "", "/messenger");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (v: View, ch?: string) => {
    setView(v);
    if (ch) setActive(ch);
    setJumpMsg(null);
    setTool(null);
    setSideOpen(false);
  };
  const handleJump = (ch: string, messageId: string) => {
    setActive(ch);
    setJumpMsg(messageId);
    setView("chat");
    setTool(null);
    setSideOpen(false);
  };

  // 채널 즐겨찾기(꾹 눌러/우클릭).
  const openChMenu = (c: Channel, x: number, y: number) => {
    setChMenu({ id: c.id, favorite: c.favorite, x: Math.min(x, window.innerWidth - 150), y: Math.min(y, window.innerHeight - 110) });
  };
  const onChanDown = (c: Channel) => (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    longPressed.current = false;
    lpStart.current = { x: e.clientX, y: e.clientY };
    const x = e.clientX, y = e.clientY;
    lpTimer.current = setTimeout(() => { longPressed.current = true; openChMenu(c, x, y); }, 460);
  };
  // 손가락 미세 흔들림엔 취소하지 않고, 12px 이상 움직였을 때만 롱프레스 취소(스크롤 의도).
  const onChanMove = (e: React.PointerEvent) => {
    if (!lpTimer.current || !lpStart.current) return;
    if (Math.hypot(e.clientX - lpStart.current.x, e.clientY - lpStart.current.y) > 12) cancelLp();
  };
  const cancelLp = () => { if (lpTimer.current) clearTimeout(lpTimer.current); lpTimer.current = null; };
  const toggleFav = () => {
    if (!chMenu) return;
    const id = chMenu.id;
    setChans((cs) => cs.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)));
    setChMenu(null);
    toggleMessengerFavoriteAction(id).catch(() => {});
  };

  const activeName = chans.find((c) => c.id === active)?.name ?? "";
  const favorites = useMemo(() => chans.filter((c) => c.favorite), [chans]);
  // 그룹(단) 나눠 보이기 — 그룹 내 즐겨찾기 우선, 그다음 sortOrder(서버 정렬 유지).
  const favSort = (list: Channel[]) => [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite));
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const ungrouped = useMemo(() => favSort(chans.filter((c) => !c.groupId || !groupIds.has(c.groupId))), [chans, groupIds]);
  const chansOfGroup = (gid: string) => favSort(chans.filter((c) => c.groupId === gid));

  const renderChan = (c: Channel) => {
    const u = unread[c.id] ?? 0;
    const on = view === "chat" && active === c.id;
    return (
      <button
        key={c.id}
        type="button"
        className={`mw__navitem mw__chan${on ? " is-on" : ""}`}
        onClick={() => { if (longPressed.current) { longPressed.current = false; return; } pick("chat", c.id); }}
        onContextMenu={(e) => { e.preventDefault(); openChMenu(c, e.clientX, e.clientY); }}
        onPointerDown={onChanDown(c)}
        onPointerUp={cancelLp}
        onPointerMove={onChanMove}
        onPointerCancel={cancelLp}
      >
        <span className="mw__navlabel">{c.name}</span>
        {c.favorite && <span className="mw__favstar" aria-label="즐겨찾기">★</span>}
        {u > 0 && !on && <span className="mw__badge">{u > 99 ? "99+" : u}</span>}
      </button>
    );
  };

  return (
    <div className="mw">
      {sideOpen && <div className="mw__backdrop" onClick={() => setSideOpen(false)} />}

      <aside className={`mw__side${sideOpen ? " is-open" : ""}`}>
        <div className="mw__brandrow">
          <span className="mw__logo">핫</span>
          <div className="mw__brandtext">
            <div className="mw__brandname">핫딜마켓 메신저</div>
          </div>
        </div>
        <Link href="/admin" className="mw__back">← 핫딜오더로</Link>

        <div className="mw__mecard">
          <span className="mw__ava">{me.name.slice(0, 1)}</span>
          <span className="mw__mename">{me.name}</span>
        </div>

        <nav className="mw__nav">
          <button type="button" className={`mw__navitem${view === "home" ? " is-on" : ""}`} onClick={() => pick("home")}>
            <span className="mw__navlabel">홈</span>
          </button>
          <button type="button" className={`mw__navitem${view === "calendar" ? " is-on" : ""}`} onClick={() => pick("calendar")}>
            <span className="mw__navlabel">캘린더</span>
          </button>

          {chans.length === 0 ? (
            <>
              <div className="mw__navsec mw__navsec--gap">채널</div>
              <div className="mw__navempty">채널이 없어요</div>
            </>
          ) : (
            <>
              {groups.map((g) => {
                const list = chansOfGroup(g.id);
                if (!list.length) return null;
                return (
                  <Fragment key={g.id}>
                    <div className="mw__navsec mw__navsec--gap">{g.name}</div>
                    {list.map(renderChan)}
                  </Fragment>
                );
              })}
              {ungrouped.length > 0 && (
                <>
                  <div className="mw__navsec mw__navsec--gap">채널</div>
                  {ungrouped.map(renderChan)}
                </>
              )}
            </>
          )}
        </nav>

        <div className="mw__sidefoot">
          <Link href="/messenger/manage" className="mw__foota">관리</Link>
          <MessengerLogoutButton className="mw__foota mw__foota--btn" />
        </div>
      </aside>

      <main className="mw__main">
        <header className={`mw__top${view === "home" ? " mw__top--home" : ""}`}>
          <button type="button" className="mw__ham" onClick={() => setSideOpen(true)} aria-label="메뉴 열기">☰</button>
          <div className="mw__toptitle">{view === "chat" ? `# ${activeName}` : view === "home" ? "홈" : view === "mytasks" ? "내 할일" : "캘린더"}</div>
          {view === "chat" && active && (
            <div className="mw__toptools">
              <AddTaskButton
                members={members}
                channelId={active}
                className="mw__topbtn"
                label={
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                    <path d="M4 6l1.4 1.4L7.6 4.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 12l1.4 1.4L7.6 10.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 18l1.4 1.4L7.6 16.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M11 6h9M11 12h9M11 18h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                }
              />
              <button type="button" className={`mw__topbtn${tool === "search" ? " is-on" : ""}`} onClick={() => setTool(tool === "search" ? null : "search")} aria-label="대화 검색">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
              <button type="button" className={`mw__topbtn${tool === "media" ? " is-on" : ""}`} onClick={() => setTool(tool === "media" ? null : "media")} aria-label="사진·영상 보관함">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" /><circle cx="8.5" cy="9" r="1.6" fill="currentColor" /><path d="M5 16l4-4 3 3 3-4 4 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          )}
        </header>
        <MessengerPushBanner />
        <div className="mw__content">
          {view === "chat" ? (
            active ? (
              <ChatPane key={active} me={me} channelId={active} channelName={activeName} members={members} scrollToId={jumpMsg} tool={tool} onCloseTool={() => setTool(null)} />
            ) : (
              <div className="mw__blank">채널이 없습니다. <Link href="/messenger/manage">관리</Link>에서 채널을 먼저 만들어 주세요.</div>
            )
          ) : view === "home" ? (
            <TasksPane me={me} members={members} favorites={favorites} onJump={handleJump} onOpenChannel={(id) => pick("chat", id)} />
          ) : view === "mytasks" ? (
            <MyTasksPane me={me} members={members} />
          ) : (
            <CalendarPane me={me} members={members} />
          )}
        </div>
        <nav className="mw__bottomnav">
          <Link href="/admin" className="mw__bnitem">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>뒤로가기</span>
          </Link>
          <button type="button" className={`mw__bnitem${view === "home" ? " is-on" : ""}`} onClick={() => pick("home")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 11l8-7 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M6 10v9h12v-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>홈</span>
          </button>
          <button type="button" className={`mw__bnitem${view === "mytasks" ? " is-on" : ""}`} onClick={() => pick("mytasks")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 6.5l1.6 1.6L8.2 5.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 16l1.6 1.6L8.2 13.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M11 7h9M11 16h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <span>내 할일</span>
          </button>
        </nav>
      </main>

      {chMenu &&
        createPortal(
          <>
            <div className="msgmenu__backdrop" onClick={() => setChMenu(null)} onContextMenu={(e) => { e.preventDefault(); setChMenu(null); }} />
            <div className="msgmenu" style={{ left: chMenu.x, top: chMenu.y }}>
              <button type="button" className="msgmenu__item" onClick={toggleFav}>{chMenu.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}</button>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
