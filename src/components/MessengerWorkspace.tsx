"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { messengerUnreadAction, messengerLogoutAction } from "@/app/actions/messenger";
import { SubmitButton } from "@/components/SubmitButton";
import { ChatPane } from "@/components/messenger/ChatPane";
import { TasksPane } from "@/components/messenger/TasksPane";
import { CalendarPane } from "@/components/messenger/CalendarPane";

type Channel = { id: string; name: string };
type Member = { id: string; name: string; active: boolean };
type View = "home" | "chat" | "calendar";

export function MessengerWorkspace({
  me,
  channels,
  members,
}: {
  me: { id: string; name: string };
  channels: Channel[];
  members: Member[];
}) {
  const [view, setView] = useState<View>("home");
  const [active, setActive] = useState<string>(channels[0]?.id ?? "");
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [sideOpen, setSideOpen] = useState(false);

  // 채널 안읽음 배지 폴링.
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const u = await messengerUnreadAction();
      if (alive) setUnread(u);
    };
    run();
    const t = setInterval(run, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [view, active]);

  const pick = (v: View, ch?: string) => {
    setView(v);
    if (ch) setActive(ch);
    setSideOpen(false);
  };

  const activeName = channels.find((c) => c.id === active)?.name ?? "";
  const topTitle = view === "chat" ? `# ${activeName}` : view === "home" ? "홈" : "캘린더";

  return (
    <div className="mw">
      {sideOpen && <div className="mw__backdrop" onClick={() => setSideOpen(false)} />}

      <aside className={`mw__side${sideOpen ? " is-open" : ""}`}>
        <div className="mw__brandrow">
          <span className="mw__logo">새</span>
          <div className="mw__brandtext">
            <div className="mw__brandname">새롭 오더야</div>
            <div className="mw__brandsub">사내 메신저</div>
          </div>
        </div>
        <Link href="/admin" className="mw__back">← 핫딜오더로 돌아가기</Link>

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

          <div className="mw__navsec mw__navsec--gap">채팅</div>
          {channels.length === 0 ? (
            <div className="mw__navempty">채널이 없어요</div>
          ) : (
            channels.map((c) => {
              const u = unread[c.id] ?? 0;
              const on = view === "chat" && active === c.id;
              return (
                <button key={c.id} type="button" className={`mw__navitem mw__chan${on ? " is-on" : ""}`} onClick={() => pick("chat", c.id)}>
                  <span className="mw__hash">#</span>
                  <span className="mw__navlabel">{c.name}</span>
                  {u > 0 && !on && <span className="mw__badge">{u > 99 ? "99+" : u}</span>}
                </button>
              );
            })
          )}
        </nav>

        <div className="mw__sidefoot">
          <Link href="/messenger/manage" className="mw__foota">관리</Link>
          <form action={messengerLogoutAction}>
            <SubmitButton className="mw__foota mw__foota--btn" pendingText="…">로그아웃</SubmitButton>
          </form>
        </div>
      </aside>

      <main className="mw__main">
        <header className={`mw__top${view === "home" ? " mw__top--home" : ""}`}>
          <button type="button" className="mw__ham" onClick={() => setSideOpen(true)} aria-label="메뉴 열기">☰</button>
          <div className="mw__toptitle">{topTitle}</div>
        </header>
        <div className="mw__content">
          {view === "chat" ? (
            active ? (
              <ChatPane key={active} me={me} channelId={active} channelName={activeName} />
            ) : (
              <div className="mw__blank">채널이 없습니다. <Link href="/messenger/manage">관리</Link>에서 채널을 먼저 만들어 주세요.</div>
            )
          ) : view === "home" ? (
            <TasksPane me={me} members={members} />
          ) : (
            <CalendarPane me={me} members={members} />
          )}
        </div>
      </main>
    </div>
  );
}
