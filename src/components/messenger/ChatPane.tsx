"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { upload } from "@vercel/blob/client";
import {
  sendMessengerMessageAction,
  loadMessengerChannelAction,
  loadMessengerNoticesAction,
  toggleMessengerNoticeAction,
  deleteMessengerMessageAction,
  toggleMessengerReactionAction,
  loadMessengerChannelMediaAction,
  searchMessengerChannelAction,
  type ChatMsgDTO,
  type MediaItemDTO,
  type SearchHitDTO,
} from "@/app/actions/messenger";
import { MediaLightbox } from "@/components/MediaLightbox";
import { MessengerComposer } from "@/components/messenger/MessengerComposer";
import { Sheet } from "@/components/Sheet";
import { compressImage } from "@/lib/image-compress";

type Member = { id: string; name: string; active: boolean };
type Notice = { id: string; body: string; name: string; at: string };
type ReplyTo = { id: string; name: string; body: string };
type Menu = { msgId: string; body: string; isNotice: boolean; mine: boolean; reacted: boolean; x: number; y: number };
type Msg = ChatMsgDTO & { pending?: boolean; failed?: boolean };
export type ChatTool = null | "search" | "media";

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
  tool = null,
  onCloseTool,
}: {
  me: { id: string; name: string };
  channelId: string;
  channelName: string;
  members: Member[];
  scrollToId?: string | null;
  tool?: ChatTool;
  onCloseTool?: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]); // 서버 진실
  const [pending, setPending] = useState<Msg[]>([]); // 낙관적 전송(서버 목록과 분리 — 폴링이 절대 못 지움)
  const [notices, setNotices] = useState<Notice[]>([]);
  const [up, setUp] = useState<{ url: string | null; pct: number }[] | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null); // 첨부 전송 확인 대기
  const [err, setErr] = useState("");
  const [lb, setLb] = useState<{ src: string; type: "image" | "video"; group?: string[] } | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHitDTO[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItemDTO[] | null>(null);
  const [, start] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpedFor = useRef<string | null>(null);
  const stick = useRef(true); // 하단 고정
  const tmpSeq = useRef(0);

  const nameSet = useMemo(() => new Set(members.map((m) => m.name)), [members]);
  const mentionRe = useMemo(
    () => (nameSet.size ? new RegExp(`(@(?:${members.map((m) => escapeRe(m.name)).join("|")}))`, "g") : null),
    [members, nameSet.size],
  );

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };
  const scrollDown = () => { stick.current = true; };

  useEffect(() => {
    if (stick.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending, up]);

  const jumpTo = (id: string) => {
    const el = rowRefs.current.get(id);
    if (!el) return;
    stick.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlight(id);
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2200);
  };

  // 채널 전환 + 폴링(3초).
  useEffect(() => {
    let alive = true;
    setMessages([]);
    setPending([]);
    setNotices([]);
    setReplyTo(null);
    jumpedFor.current = null;
    stick.current = !scrollToId;
    if (!channelId) return;
    const load = async () => {
      const [r, n] = await Promise.all([loadMessengerChannelAction(channelId), loadMessengerNoticesAction(channelId)]);
      if (!alive) return;
      setNotices(n.notices);
      setMessages(r.messages); // 서버 진실만 갱신 — 낙관적 pending 은 별도 상태라 안전
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [channelId, scrollToId]);

  useEffect(() => {
    if (scrollToId && messages.some((m) => m.id === scrollToId) && jumpedFor.current !== scrollToId) {
      jumpedFor.current = scrollToId;
      setTimeout(() => jumpTo(scrollToId), 60);
    }
  }, [scrollToId, messages]);

  // 도구(검색/보관함) 로드.
  useEffect(() => {
    if (tool !== "search") { setQ(""); setHits([]); }
    if (tool !== "media") setMediaItems(null);
    if (tool === "search") setTimeout(() => inputRef.current?.focus(), 50);
  }, [tool]);
  useEffect(() => {
    if (tool !== "media" || !channelId) return;
    let alive = true;
    loadMessengerChannelMediaAction(channelId).then((r) => { if (alive) setMediaItems(r.items); });
    return () => { alive = false; };
  }, [tool, channelId]);
  useEffect(() => {
    if (tool !== "search") return;
    const query = q.trim();
    if (!query) { setHits([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      searchMessengerChannelAction(channelId, query).then((r) => { if (alive) setHits(r.hits); });
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [q, tool, channelId]);

  // 전송(낙관적) — 보낸 메시지를 즉시 pending 으로 붙이고, 서버 반영 후 실제 목록으로 교체.
  const failTemp = (tempId: string, msg: string) => {
    setPending((p) => p.map((x) => (x.id === tempId ? { ...x, pending: false, failed: true } : x)));
    if (msg) setErr(msg);
  };
  const onSend = (body: string) => {
    const text = body.trim();
    if (!text || !channelId) return;
    const rt = replyTo;
    setReplyTo(null);
    const tempId = `tmp-${Date.now()}-${tmpSeq.current++}`;
    stick.current = true;
    setPending((p) => [
      ...p,
      {
        id: tempId, memberId: me.id, memberName: me.name, body: text,
        mediaUrl: null, mediaType: null, mediaUrls: [], fileUrl: null, fileName: null,
        replyToName: rt?.name ?? null, replyToBody: rt?.body ?? null,
        notice: false, reactions: [], reactedByMe: false, at: new Date().toISOString(), pending: true,
      },
    ]);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("channelId", channelId);
        fd.set("body", text);
        if (rt) {
          fd.set("replyToId", rt.id);
          fd.set("replyToName", rt.name);
          fd.set("replyToBody", rt.body);
        }
        const r = await sendMessengerMessageAction(fd);
        if (r?.error) return failTemp(tempId, r.error);
        const res = await loadMessengerChannelAction(channelId);
        stick.current = true;
        setMessages(res.messages);
        setPending((p) => p.filter((x) => x.id !== tempId)); // 실제 메시지가 목록에 들어왔으니 임시분 제거
      } catch {
        failTemp(tempId, "전송에 실패했어요.");
      }
    });
  };

  // 첨부 선택 → 바로 안 보내고 'N장의 사진을 보내시겠습니까?' 확인 후 업로드.
  const onFiles = (files: File[]) => {
    if (!files.length || !channelId) return;
    if (files.some((f) => f.type.startsWith("video") && f.size > 50 * 1024 * 1024))
      return setErr("동영상은 50MB 이하만 보낼 수 있어요. 짧게 잘라서 올려주세요.");
    if (files.some((f) => f.size > 100 * 1024 * 1024)) return setErr("100MB 이하 파일만 보낼 수 있어요.");
    setErr("");
    setPendingFiles(files);
  };
  // 확인 후 실제 업로드(사진 묶어보내기 + 동영상).
  const doUpload = async (files: File[]) => {
    if (!files.length || !channelId) return;
    const images = files.filter((f) => !f.type.startsWith("video")).slice(0, 10);
    const videos = files.filter((f) => f.type.startsWith("video"));
    stick.current = true;
    const objectUrls: string[] = [];
    try {
      if (images.length) {
        const previews = images.map((f) => URL.createObjectURL(f));
        objectUrls.push(...previews);
        setUp(previews.map((u) => ({ url: u, pct: 0 })));
        const urls = await Promise.all(
          images.map(async (f, idx) => {
            const cf = await compressImage(f); // 업로드 전 리사이즈+압축(원본 실패 시 원본 유지)
            const b = await upload(cf.name, cf, {
              access: "public",
              handleUploadUrl: "/api/chat/upload",
              contentType: cf.type || undefined,
              onUploadProgress: (ev) =>
                setUp((u) => (u ? u.map((it, i) => (i === idx ? { ...it, pct: Math.round(ev.percentage) } : it)) : u)),
            });
            return b.url;
          }),
        );
        const fd = new FormData();
        fd.set("channelId", channelId);
        fd.set("mediaType", "image");
        urls.forEach((u) => fd.append("mediaUrls", u));
        const r = await sendMessengerMessageAction(fd);
        if (r?.error) setErr(r.error);
        setUp(null);
      }
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
        fd.set("mediaUrl", b.url);
        fd.set("mediaType", "video");
        const r = await sendMessengerMessageAction(fd);
        if (r?.error) setErr(r.error);
        setUp(null);
      }
      const res = await loadMessengerChannelAction(channelId);
      stick.current = true;
      setMessages(res.messages);
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : "";
      setErr(msg ? `첨부 실패: ${msg}` : "첨부 전송에 실패했어요.");
    } finally {
      setUp(null);
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
    }
  };

  // 일반 파일 첨부(문서 등, 최대 100MB) — 압축 없이 그대로 업로드.
  const onPickFile = (file: File) => {
    if (!file || !channelId) return;
    if (file.size > 100 * 1024 * 1024) return setErr("100MB 이하 파일만 보낼 수 있어요.");
    setErr("");
    doUploadFile(file);
  };
  const doUploadFile = async (file: File) => {
    if (!channelId) return;
    stick.current = true;
    try {
      setUp([{ url: null, pct: 0 }]);
      const b = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/chat/upload",
        contentType: file.type || undefined,
        onUploadProgress: (ev) => setUp([{ url: null, pct: Math.round(ev.percentage) }]),
      });
      const fd = new FormData();
      fd.set("channelId", channelId);
      // downloadUrl 은 content-disposition: attachment 라서 크로스오리진에서도 실제 '다운로드'가 된다
      // (브라우저는 크로스오리진 링크의 download 속성을 무시하므로 url 이면 그냥 열리기만 함).
      fd.set("fileUrl", b.downloadUrl ?? b.url);
      fd.set("fileName", file.name);
      const r = await sendMessengerMessageAction(fd);
      if (r?.error) setErr(r.error);
      const res = await loadMessengerChannelAction(channelId);
      stick.current = true;
      setMessages(res.messages);
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : "";
      setErr(msg ? `파일 전송 실패: ${msg}` : "파일 전송에 실패했어요.");
    } finally {
      setUp(null);
    }
  };

  // 꾹 눌러(모바일) / 우클릭(PC) 메뉴.
  const openMenu = (m: Msg, x: number, y: number) => {
    if (m.pending || m.failed) return;
    setMenu({ msgId: m.id, body: m.body, isNotice: m.notice, mine: m.memberId === me.id, reacted: m.reactedByMe, x: Math.min(x, window.innerWidth - 150), y: Math.min(y, window.innerHeight - 250) });
  };
  const onBubbleDown = (m: Msg) => (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    const x = e.clientX, y = e.clientY;
    lpTimer.current = setTimeout(() => openMenu(m, x, y), 260);
  };
  const cancelLp = () => {
    if (lpTimer.current) clearTimeout(lpTimer.current);
    lpTimer.current = null;
  };
  const doReply = () => {
    if (!menu) return;
    setReplyTo({ id: menu.msgId, name: messages.find((x) => x.id === menu.msgId)?.memberName ?? "", body: menu.body || "사진" });
    setMenu(null);
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
    try { await navigator.clipboard.writeText(menu.body); } catch {}
    setMenu(null);
  };
  const doDelete = () => {
    if (!menu) return;
    const { msgId } = menu;
    setMenu(null);
    if (!confirm("이 메시지를 전송 취소할까요?")) return;
    setMessages((ms) => ms.filter((x) => x.id !== msgId)); // 낙관적 제거
    setNotices((ns) => ns.filter((x) => x.id !== msgId)); // 공지였으면 상단 바도 즉시 제거
    start(async () => {
      const r = await deleteMessengerMessageAction(msgId);
      if (r?.error) setErr(r.error);
      const [res, n] = await Promise.all([loadMessengerChannelAction(channelId), loadMessengerNoticesAction(channelId)]);
      setMessages(res.messages);
      setNotices(n.notices);
    });
  };

  // 공감(체크) — 카톡 공감처럼 메시지에 ✓. 낙관적 토글 후 서버 반영.
  const applyReact = (id: string, on: boolean) => {
    setMessages((ms) =>
      ms.map((x) => {
        if (x.id !== id) return x;
        const names = on ? [...x.reactions.filter((n) => n !== me.name), me.name] : x.reactions.filter((n) => n !== me.name);
        return { ...x, reactedByMe: on, reactions: names };
      }),
    );
    start(async () => {
      await toggleMessengerReactionAction(id, on);
      const res = await loadMessengerChannelAction(channelId);
      setMessages(res.messages);
    });
  };
  const doReact = () => {
    if (!menu) return;
    const { msgId, reacted } = menu;
    setMenu(null);
    applyReact(msgId, !reacted);
  };
  const toggleReactRow = (m: Msg) => {
    if (m.pending || m.failed) return;
    applyReact(m.id, !m.reactedByMe);
  };

  const renderBody = (body: string) => {
    if (!mentionRe || !body.includes("@")) return body;
    return body.split(mentionRe).map((p, i) =>
      p.startsWith("@") && nameSet.has(p.slice(1)) ? <span key={i} className="msgr__mention">{p}</span> : <span key={i}>{p}</span>,
    );
  };

  const mediaImageUrls = useMemo(() => (mediaItems ?? []).filter((i) => i.type === "image").map((i) => i.url), [mediaItems]);
  const view = useMemo(() => [...messages, ...pending], [messages, pending]); // 서버 + 낙관적 합쳐서 렌더

  return (
    <div className="chatpane">
      {notices.length > 0 && tool === null && (
        <button type="button" className="chatpane__notice" onClick={() => jumpTo(notices[0].id)}>
          <span className="chatpane__noticetag">공지</span>
          <span className="chatpane__noticebody">{notices[0].body || "사진"}</span>
        </button>
      )}

      <div className="chatpane__scroll" ref={scrollRef} onScroll={onScroll}>
        {view.length === 0 ? (
          <div className="chatpane__empty">
            <div className="chatpane__emptyhash">#{channelName}</div>
            <p>첫 메시지를 남겨보세요.</p>
          </div>
        ) : (
          view.map((m, i) => {
            const mine = m.memberId === me.id;
            const prev = view[i - 1];
            const showDay = !prev || dayKey(prev.at) !== dayKey(m.at);
            const showName = !mine && (!prev || prev.memberId !== m.memberId || showDay);
            return (
              <div key={m.id} ref={(el) => { if (el) rowRefs.current.set(m.id, el); }}>
                {showDay && <div className="chatpane__day">{fmtDay(m.at)}</div>}
                <div className={`msgr__row${mine ? " is-mine" : ""}${highlight === m.id ? " is-hl" : ""}${m.pending ? " is-pending" : ""}${m.failed ? " is-failed" : ""}`}>
                  <div className="msgr__bubblewrap">
                    {showName && <div className="msgr__sender">{m.memberName}</div>}
                    <div className="msgr__bubblerow">
                      {mine && <span className="msgr__time">{m.pending ? "전송 중" : m.failed ? "전송 실패" : fmtTime(m.at)}</span>}
                      <div
                        className={`msgr__bubble${mine ? " is-mine" : ""}${m.notice ? " is-notice" : ""}${(m.mediaUrl || m.mediaUrls?.length) && !m.body && !m.replyToName ? " msgr__bubble--media" : ""}`}
                        onPointerDown={onBubbleDown(m)}
                        onPointerUp={cancelLp}
                        onPointerMove={cancelLp}
                        onPointerCancel={cancelLp}
                        onContextMenu={(e) => { e.preventDefault(); openMenu(m, e.clientX, e.clientY); }}
                      >
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
                        {m.fileUrl && (
                          <a className="msgr__file" href={m.fileUrl} target="_blank" rel="noreferrer" download={m.fileName ?? undefined}>
                            <span className="msgr__fileicon">
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
                            </span>
                            <span className="msgr__filename">{m.fileName ?? "파일"}</span>
                            <span className="msgr__filedl">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 4v10m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                            </span>
                          </a>
                        )}
                        {m.body && <div className="msgr__text">{renderBody(m.body)}</div>}
                      </div>
                      {!mine && <span className="msgr__time">{fmtTime(m.at)}</span>}
                    </div>
                    {m.reactions.length > 0 && (
                      <button type="button" className={`msgr__react${m.reactedByMe ? " is-mine" : ""}`} onClick={() => toggleReactRow(m)} title={m.reactions.join(", ")}>
                        <span className="msgr__reactcheck">✓</span>
                        <span className="msgr__reactnames">{m.reactions.join(", ")}</span>
                      </button>
                    )}
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
                        <div className="msgr__upfile">업로드 중</div>
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

      <MessengerComposer
        members={members}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onSend={onSend}
        onFiles={onFiles}
        onFile={onPickFile}
        uploading={!!up}
      />

      {/* 검색 오버레이 */}
      {tool === "search" && (
        <div className="chatpane__panel">
          <div className="chatpane__panelhead">
            <input
              ref={inputRef}
              className="chatpane__searchinput"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이 채널에서 검색"
            />
            <button type="button" className="chatpane__panelclose" onClick={onCloseTool} aria-label="닫기">✕</button>
          </div>
          <div className="chatpane__panelbody">
            {q.trim() && hits.length === 0 && <div className="chatpane__panelempty">검색 결과가 없어요.</div>}
            {hits.map((h) => (
              <button key={h.messageId} type="button" className="chatpane__hit" onClick={() => { onCloseTool?.(); setTimeout(() => jumpTo(h.messageId), 40); }}>
                <div className="chatpane__hitmeta"><b>{h.name}</b> · {fmtDay(h.at)} {fmtTime(h.at)}</div>
                <div className="chatpane__hitbody">{h.body}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 보관함(사진·영상) 오버레이 */}
      {tool === "media" && (
        <div className="chatpane__panel">
          <div className="chatpane__panelhead">
            <div className="chatpane__paneltitle">사진 · 동영상</div>
            <button type="button" className="chatpane__panelclose" onClick={onCloseTool} aria-label="닫기">✕</button>
          </div>
          <div className="chatpane__panelbody">
            {mediaItems === null ? (
              <div className="chatpane__panelempty">불러오는 중…</div>
            ) : mediaItems.length === 0 ? (
              <div className="chatpane__panelempty">올라온 사진·영상이 없어요.</div>
            ) : (
              <div className="chatpane__mediagrid">
                {mediaItems.map((it, i) => (
                  <button
                    key={`${it.messageId}-${i}`}
                    type="button"
                    className="chatpane__mediacell"
                    onClick={() => setLb(it.type === "video" ? { src: it.url, type: "video" } : { src: it.url, type: "image", group: mediaImageUrls })}
                  >
                    {it.type === "video" ? (
                      <video src={it.url} className="chatpane__mediathumb" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.url} alt="첨부" className="chatpane__mediathumb" />
                    )}
                    {it.type === "video" && <span className="chatpane__mediaplay">▶</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {menu &&
        createPortal(
          <>
            <div className="msgmenu__backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
            <div className="msgmenu" style={{ left: menu.x, top: menu.y }}>
              <button type="button" className="msgmenu__item" onClick={doReact}>{menu.reacted ? "체크 해제" : "✓ 체크"}</button>
              <button type="button" className="msgmenu__item" onClick={doReply}>댓글</button>
              <button type="button" className="msgmenu__item" onClick={doNotice}>{menu.isNotice ? "공지 해제" : "공지 등록"}</button>
              <button type="button" className="msgmenu__item" onClick={doCopy}>복사</button>
              {menu.mine && <button type="button" className="msgmenu__item msgmenu__item--danger" onClick={doDelete}>전송 취소</button>}
            </div>
          </>,
          document.body,
        )}

      {lb && <MediaLightbox media={{ src: lb.src, type: lb.type }} group={lb.group} onClose={() => setLb(null)} />}

      {pendingFiles && (
        <Sheet onClose={() => setPendingFiles(null)}>
          <div className="sheet__panel" style={{ maxWidth: 340 }}>
            <div className="confirm__title" style={{ marginBottom: 0, textAlign: "center" }}>
              {pendingFiles.some((f) => f.type.startsWith("video"))
                ? `${pendingFiles.length}개 파일을 보내시겠습니까?`
                : `${pendingFiles.length}장의 사진을 보내시겠습니까?`}
            </div>
            <div className="confirm__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setPendingFiles(null)}>아니오</button>
              <button type="button" className="btn btn--primary" onClick={() => { const f = pendingFiles; setPendingFiles(null); doUpload(f); }}>확인</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
