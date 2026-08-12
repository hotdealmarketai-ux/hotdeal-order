"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { upload } from "@vercel/blob/client";
import {
  sendMessengerMessageAction,
  loadMessengerChannelAction,
  loadMessengerNoticesAction,
  toggleMessengerNoticeAction,
  type ChatMsgDTO,
} from "@/app/actions/messenger";
import { MediaLightbox } from "@/components/MediaLightbox";

type Member = { id: string; name: string; active: boolean };
type Notice = { id: string; body: string; name: string; at: string };
type ReplyTo = { id: string; name: string; body: string };
type Menu = { msgId: string; body: string; isNotice: boolean; x: number; y: number };

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(iso));
const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" }).format(new Date(iso));
const dayKey = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function ChatPane({
  me,
  channelId,
  channelName,
  members,
  scrollToId,
}: {
  me: { id: string; name: string };
  channelId: string;
  channelName: string;
  members: Member[];
  scrollToId?: string | null;
}) {
  const [messages, setMessages] = useState<ChatMsgDTO[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [input, setInput] = useState("");
  const [up, setUp] = useState<{ url: string | null; pct: number }[] | null>(null); // 업로드 미리보기 + 진행률(여러 장)
  const [err, setErr] = useState("");
  const [lb, setLb] = useState<{ src: string; type: "image" | "video"; group?: string[] } | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpedFor = useRef<string | null>(null);
  const stick = useRef(true); // 하단 고정 — 바닥 근처면 새 메시지에 자동 스크롤

  const activeMembers = useMemo(() => members.filter((m) => m.active), [members]);
  const nameSet = useMemo(() => new Set(members.map((m) => m.name)), [members]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };
  const scrollDown = () => {
    stick.current = true; // 실제 스크롤은 아래 messages/up 이펙트가 커밋 후 수행
  };

  // 메시지/업로드 미리보기가 바뀐 뒤(커밋 후) 하단 고정 상태면 맨 아래로.
  useEffect(() => {
    if (stick.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, up]);

  const jumpTo = (id: string) => {
    const el = rowRefs.current.get(id);
    if (!el) return;
    stick.current = false; // 특정 메시지로 점프 중엔 하단 고정 해제(폴링이 바닥으로 끌지 않게)
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlight(id);
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2200);
  };

  // 채널 전환 시 초기화 + 폴링(메시지·공지·읽음).
  useEffect(() => {
    let alive = true;
    setMessages([]);
    setNotices([]);
    setReplyTo(null);
    jumpedFor.current = null;
    stick.current = !scrollToId; // 진입 시 하단 고정(멘션 점프면 해제)
    if (!channelId) return;
    const load = async () => {
      const [r, n] = await Promise.all([loadMessengerChannelAction(channelId), loadMessengerNoticesAction(channelId)]);
      if (!alive) return;
      setNotices(n.notices);
      setMessages(r.messages);
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [channelId, scrollToId]);

  // 멘션 등으로 특정 메시지로 점프(로드 완료 후 1회).
  useEffect(() => {
    if (scrollToId && messages.some((m) => m.id === scrollToId) && jumpedFor.current !== scrollToId) {
      jumpedFor.current = scrollToId;
      setTimeout(() => jumpTo(scrollToId), 60);
    }
  }, [scrollToId, messages]);

  // @자동완성 — 커서 앞의 "@검색어" 감지.
  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInput(v);
    const caret = e.target.selectionStart ?? v.length;
    const upto = v.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /\s/.test(upto[at - 1]))) {
      const q = upto.slice(at + 1);
      if (!/\s/.test(q)) {
        setMention({ query: q, start: at });
        return;
      }
    }
    setMention(null);
  };
  const pickMention = (name: string) => {
    if (!mention) return;
    const before = input.slice(0, mention.start);
    const after = input.slice((inputRef.current?.selectionStart ?? input.length));
    const next = `${before}@${name} ${after}`;
    setInput(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = (before + `@${name} `).length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };
  const mentionList = mention
    ? activeMembers.filter((m) => m.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6)
    : [];

  const send = () => {
    const body = input.trim();
    if (!body || !channelId) return;
    setInput("");
    setMention(null);
    const rt = replyTo;
    setReplyTo(null);
    start(async () => {
      const fd = new FormData();
      fd.set("channelId", channelId);
      fd.set("body", body);
      if (rt) {
        fd.set("replyToId", rt.id);
        fd.set("replyToName", rt.name);
        fd.set("replyToBody", rt.body);
      }
      const r = await sendMessengerMessageAction(fd);
      if (r?.error) setErr(r.error);
      const res = await loadMessengerChannelAction(channelId);
      setMessages(res.messages);
      scrollDown();
    });
  };

  // 첨부(사진 여러 장 묶어보내기 + 동영상). 사진은 한 메시지(그리드), 동영상은 각각 개별 메시지.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length || !channelId) return;
    if (files.some((f) => f.size > 100 * 1024 * 1024)) return setErr("100MB 이하 파일만 보낼 수 있어요.");
    const images = files.filter((f) => !f.type.startsWith("video")).slice(0, 10);
    const videos = files.filter((f) => f.type.startsWith("video"));
    setErr("");
    stick.current = true;
    let bodyLeft = input.trim(); // 타이핑한 글은 첫 메시지에만 붙임
    setInput("");
    const objectUrls: string[] = [];
    try {
      // 1) 사진 묶음 → 한 메시지(그리드)
      if (images.length) {
        const previews = images.map((f) => URL.createObjectURL(f));
        objectUrls.push(...previews);
        setUp(previews.map((u) => ({ url: u, pct: 0 })));
        const urls = await Promise.all(
          images.map((f, idx) =>
            upload(f.name, f, {
              access: "public",
              handleUploadUrl: "/api/chat/upload",
              contentType: f.type || undefined,
              onUploadProgress: (ev) =>
                setUp((u) => (u ? u.map((it, i) => (i === idx ? { ...it, pct: Math.round(ev.percentage) } : it)) : u)),
            }).then((b) => b.url),
          ),
        );
        const fd = new FormData();
        fd.set("channelId", channelId);
        fd.set("body", bodyLeft);
        bodyLeft = "";
        fd.set("mediaType", "image");
        urls.forEach((u) => fd.append("mediaUrls", u));
        const r = await sendMessengerMessageAction(fd);
        if (r?.error) setErr(r.error);
        setUp(null);
      }
      // 2) 동영상 → 각각 개별 메시지
      for (const v of videos) {
        setUp([{ url: null, pct: 0 }]);
        const b = await upload(v.name, v, {
          access: "public",
          handleUploadUrl: "/api/chat/upload",
          contentType: v.type || undefined,
          onUploadProgress: (ev) => setUp([{ url: null, pct: Math.round(ev.percentage) }]),
        });
        const fd = new FormData();
        fd.set("channelId", channelId);
        fd.set("body", bodyLeft);
        bodyLeft = "";
        fd.set("mediaUrl", b.url);
        fd.set("mediaType", "video");
        const r = await sendMessengerMessageAction(fd);
        if (r?.error) setErr(r.error);
        setUp(null);
      }
      const res = await loadMessengerChannelAction(channelId);
      setMessages(res.messages);
      stick.current = true;
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : "";
      setErr(msg ? `첨부 실패: ${msg}` : "첨부 전송에 실패했어요.");
    } finally {
      setUp(null);
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
    }
  };

  // 꾹 눌러 메뉴(모바일) / 우클릭(PC).
  const openMenu = (m: ChatMsgDTO, x: number, y: number) => {
    setMenu({ msgId: m.id, body: m.body, isNotice: m.notice, x: Math.min(x, window.innerWidth - 170), y: Math.min(y, window.innerHeight - 160) });
  };
  const onBubbleDown = (m: ChatMsgDTO) => (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return; // 마우스는 우클릭으로
    const x = e.clientX, y = e.clientY;
    lpTimer.current = setTimeout(() => openMenu(m, x, y), 480);
  };
  const cancelLp = () => {
    if (lpTimer.current) clearTimeout(lpTimer.current);
    lpTimer.current = null;
  };

  const doReply = () => {
    if (!menu) return;
    setReplyTo({ id: menu.msgId, name: messages.find((x) => x.id === menu.msgId)?.memberName ?? "", body: menu.body || "사진" });
    setMenu(null);
    inputRef.current?.focus();
  };
  const doNotice = () => {
    if (!menu) return;
    const { msgId, isNotice } = menu;
    setMenu(null);
    start(async () => {
      await toggleMessengerNoticeAction(msgId, !isNotice);
      const [r, n] = await Promise.all([loadMessengerChannelAction(channelId), loadMessengerNoticesAction(channelId)]);
      setMessages(r.messages);
      setNotices(n.notices);
    });
  };
  const doCopy = async () => {
    if (!menu) return;
    try {
      await navigator.clipboard.writeText(menu.body);
    } catch {}
    setMenu(null);
  };

  // 본문 렌더 — @멤버 강조.
  const renderBody = (body: string) => {
    if (!body.includes("@") || nameSet.size === 0) return body;
    const re = new RegExp(`(@(?:${members.map((m) => escapeRe(m.name)).join("|")}))`, "g");
    return body.split(re).map((p, i) =>
      p.startsWith("@") && nameSet.has(p.slice(1)) ? (
        <span key={i} className="msgr__mention">{p}</span>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  };

  return (
    <div className="chatpane">
      {notices.length > 0 && (
        <button type="button" className="chatpane__notice" onClick={() => jumpTo(notices[0].id)}>
          <span className="chatpane__noticepin">📌 공지</span>
          <span className="chatpane__noticebody">{notices[0].body}</span>
          {notices.length > 1 && <span className="chatpane__noticemore">+{notices.length - 1}</span>}
        </button>
      )}

      <div className="chatpane__scroll" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <div className="chatpane__empty">
            <div className="chatpane__emptyhash">#{channelName}</div>
            <p>채널의 첫 메시지를 남겨보세요.</p>
          </div>
        ) : (
          messages.map((m, i) => {
            const mine = m.memberId === me.id;
            const prev = messages[i - 1];
            const showDay = !prev || dayKey(prev.at) !== dayKey(m.at);
            const showName = !mine && (!prev || prev.memberId !== m.memberId || showDay);
            return (
              <div key={m.id} ref={(el) => { if (el) rowRefs.current.set(m.id, el); }}>
                {showDay && <div className="chatpane__day">{fmtDay(m.at)}</div>}
                <div className={`msgr__row${mine ? " is-mine" : ""}${highlight === m.id ? " is-hl" : ""}`}>
                  <div className="msgr__bubblewrap">
                    {showName && <div className="msgr__sender">{m.memberName}</div>}
                    <div className="msgr__bubblerow">
                      {mine && <span className="msgr__time">{fmtTime(m.at)}</span>}
                      <div
                        className={`msgr__bubble${mine ? " is-mine" : ""}${m.notice ? " is-notice" : ""}${m.mediaUrl && !m.body && !m.replyToName && !m.notice ? " msgr__bubble--media" : ""}`}
                        onPointerDown={onBubbleDown(m)}
                        onPointerUp={cancelLp}
                        onPointerMove={cancelLp}
                        onPointerCancel={cancelLp}
                        onContextMenu={(e) => { e.preventDefault(); openMenu(m, e.clientX, e.clientY); }}
                      >
                        {m.notice && <span className="msgr__noticebadge">📌 공지</span>}
                        {m.replyToName && (
                          <div className="msgr__quote">
                            <span className="msgr__quotename">{m.replyToName}</span>
                            <span className="msgr__quotebody">{m.replyToBody}</span>
                          </div>
                        )}
                        {m.mediaUrls && m.mediaUrls.length > 1 ? (
                          <div className="msgr__grid" data-n={Math.min(m.mediaUrls.length, 4)}>
                            {m.mediaUrls.slice(0, 4).map((u, gi) => {
                              const extra = m.mediaUrls.length - 4;
                              return (
                                <button key={gi} type="button" className="msgr__gtile" onClick={() => setLb({ src: u, type: "image", group: m.mediaUrls })}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={u} alt="첨부" />
                                  {gi === 3 && extra > 0 && <span className="msgr__gmore">+{extra}</span>}
                                </button>
                              );
                            })}
                          </div>
                        ) : m.mediaUrl ? (
                          m.mediaType === "video" ? (
                            <video src={m.mediaUrl} controls className="msgr__media" />
                          ) : (
                            <button type="button" className="media-btn" onClick={() => setLb({ src: m.mediaUrl!, type: "image" })}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.mediaUrl} alt="첨부" className="msgr__media" />
                            </button>
                          )
                        ) : null}
                        {m.body && <div className="msgr__text">{renderBody(m.body)}</div>}
                      </div>
                      {!mine && <span className="msgr__time">{fmtTime(m.at)}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {up && up.length > 0 && (
          <div className="msgr__row is-mine">
            <div className="msgr__bubblewrap">
              <div className="msgr__bubblerow">
                <div className="msgr__bubble msgr__bubble--media msgr__uploading">
                  {up.length > 1 ? (
                    <div className="msgr__grid" data-n={Math.min(up.length, 4)}>
                      {up.slice(0, 4).map((it, i) => (
                        <div key={i} className="msgr__gtile">
                          {it.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.url} alt="업로드 중" />
                          ) : (
                            <div className="msgr__upfile" />
                          )}
                          <div className="msgr__upoverlay"><span className="msgr__uppct">{it.pct}%</span></div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      {up[0].url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={up[0].url} alt="업로드 중" className="msgr__media" />
                      ) : (
                        <div className="msgr__upfile">동영상 업로드 중</div>
                      )}
                      <div className="msgr__upoverlay"><span className="msgr__uppct">{up[0].pct}%</span></div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {err && <div className="notice notice--error" style={{ margin: "0 12px 8px" }}>{err}</div>}

      {replyTo && (
        <div className="chatpane__reply">
          <div className="chatpane__replymain">
            <span className="chatpane__replyname">{replyTo.name}에게 답장</span>
            <span className="chatpane__replybody">{replyTo.body}</span>
          </div>
          <button type="button" className="chatpane__replyx" onClick={() => setReplyTo(null)} aria-label="답장 취소">✕</button>
        </div>
      )}

      <div className="msgr__composer chatpane__composer">
        {mention && mentionList.length > 0 && (
          <div className="chatpane__mentions">
            {mentionList.map((m) => (
              <button key={m.id} type="button" className="chatpane__mentionitem" onClick={() => pickMention(m.name)}>
                <span className="chatpane__mentionava">{m.name.slice(0, 1)}</span>
                {m.name}
              </button>
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={onFile} />
        <button type="button" className="msgr__attach" onClick={() => fileRef.current?.click()} disabled={!!up || pending} aria-label="사진·영상 첨부">
          {up ? "…" : "＋"}
        </button>
        <input
          ref={inputRef}
          className="input msgr__input"
          value={input}
          onChange={onInputChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (mention && mentionList.length > 0) pickMention(mentionList[0].name);
              else send();
            }
            if (e.key === "Escape") setMention(null);
          }}
          placeholder={`#${channelName} 에 메시지 (@로 멘션)`}
        />
        <button type="button" className="btn btn--primary msgr__send" onClick={send} disabled={pending || !input.trim()}>
          전송
        </button>
      </div>

      {menu &&
        createPortal(
          <>
            <div className="msgmenu__backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
            <div className="msgmenu" style={{ left: menu.x, top: menu.y }}>
              <button type="button" className="msgmenu__item" onClick={doReply}>댓글</button>
              <button type="button" className="msgmenu__item" onClick={doNotice}>{menu.isNotice ? "공지 해제" : "공지 등록"}</button>
              <button type="button" className="msgmenu__item" onClick={doCopy}>복사</button>
            </div>
          </>,
          document.body,
        )}

      {lb && <MediaLightbox media={{ src: lb.src, type: lb.type }} group={lb.group} onClose={() => setLb(null)} />}
    </div>
  );
}
