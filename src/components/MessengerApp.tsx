"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import {
  sendMessengerMessageAction,
  loadMessengerChannelAction,
  messengerUnreadAction,
} from "@/app/actions/messenger";
import { MediaLightbox } from "@/components/MediaLightbox";

type Msg = {
  id: string;
  memberId: string;
  memberName: string;
  body: string;
  mediaUrl: string | null;
  mediaType: string | null;
  at: string;
};
type Channel = { id: string; name: string };

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(d);
};
const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" }).format(new Date(iso));
const dayKey = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);

export function MessengerApp({
  me,
  channels,
}: {
  me: { id: string; name: string };
  channels: Channel[];
}) {
  const [active, setActive] = useState<string>(channels[0]?.id ?? "");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [lb, setLb] = useState<{ src: string; type: "image" | "video" } | null>(null);
  const [pending, start] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scrollDown = () =>
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });

  // 채널 전환/폴링 — 메시지 로드(읽음 처리 포함) + 안읽음 배지.
  useEffect(() => {
    let alive = true;
    if (!active) return;
    const loadMsgs = async () => {
      const r = await loadMessengerChannelAction(active);
      if (!alive) return;
      setMessages((prev) => {
        const same = prev.length === r.messages.length && prev[prev.length - 1]?.id === r.messages[r.messages.length - 1]?.id;
        if (!same) scrollDown();
        return r.messages;
      });
    };
    loadMsgs();
    const t = setInterval(loadMsgs, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [active]);

  useEffect(() => {
    let alive = true;
    const loadUnread = async () => {
      const u = await messengerUnreadAction();
      if (alive) setUnread(u);
    };
    loadUnread();
    const t = setInterval(loadUnread, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [active]);

  const send = () => {
    const body = input.trim();
    if (!body || !active) return;
    setInput("");
    start(async () => {
      const fd = new FormData();
      fd.set("channelId", active);
      fd.set("body", body);
      const r = await sendMessengerMessageAction(fd);
      if (r?.error) setErr(r.error);
      const res = await loadMessengerChannelAction(active);
      setMessages(res.messages);
      scrollDown();
    });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !active) return;
    if (file.size > 100 * 1024 * 1024) return setErr("100MB 이하 파일만 보낼 수 있어요.");
    const type: "image" | "video" = file.type.startsWith("video") ? "video" : "image";
    setUploading(true);
    setErr("");
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/chat/upload",
        contentType: file.type || undefined,
      });
      const fd = new FormData();
      fd.set("channelId", active);
      fd.set("body", input.trim());
      fd.set("mediaUrl", blob.url);
      fd.set("mediaType", type);
      setInput("");
      const r = await sendMessengerMessageAction(fd);
      if (r?.error) setErr(r.error);
      const res = await loadMessengerChannelAction(active);
      setMessages(res.messages);
      scrollDown();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setErr(msg ? `첨부 실패: ${msg}` : "첨부 전송에 실패했어요. 저장소 설정을 확인해 주세요.");
    } finally {
      setUploading(false);
    }
  };

  if (channels.length === 0) {
    return (
      <div className="empty" style={{ marginTop: 24 }}>
        <p>아직 채널이 없어요. 관리에서 채널을 먼저 만들어 주세요.</p>
      </div>
    );
  }

  return (
    <div className="msgr">
      {/* 채널 탭 */}
      <div className="msgr__tabs">
        {channels.map((c) => {
          const on = c.id === active;
          const u = unread[c.id] ?? 0;
          return (
            <button key={c.id} type="button" className={`msgr__tab${on ? " is-on" : ""}`} onClick={() => setActive(c.id)}>
              #{c.name}
              {u > 0 && !on && <span className="msgr__tabbadge">{u > 99 ? "99+" : u}</span>}
            </button>
          );
        })}
      </div>

      {/* 메시지 */}
      <div className="msgr__scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="msgr__empty">첫 메시지를 남겨보세요.</div>
        ) : (
          messages.map((m, i) => {
            const mine = m.memberId === me.id;
            const prev = messages[i - 1];
            const showDay = !prev || dayKey(prev.at) !== dayKey(m.at);
            const showName = !mine && (!prev || prev.memberId !== m.memberId || showDay);
            return (
              <div key={m.id}>
                {showDay && <div className="msgr__day">{fmtDay(m.at)}</div>}
                <div className={`msgr__row${mine ? " is-mine" : ""}`}>
                  <div className="msgr__bubblewrap">
                    {showName && <div className="msgr__sender">{m.memberName}</div>}
                    <div className="msgr__bubblerow">
                      {mine && <span className="msgr__time">{fmtTime(m.at)}</span>}
                      <div className={`msgr__bubble${mine ? " is-mine" : ""}`}>
                        {m.mediaUrl ? (
                          m.mediaType === "video" ? (
                            <video src={m.mediaUrl} controls className="msgr__media" />
                          ) : (
                            <button
                              type="button"
                              className="media-btn"
                              onClick={() => setLb({ src: m.mediaUrl!, type: "image" })}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.mediaUrl} alt="첨부" className="msgr__media" />
                            </button>
                          )
                        ) : null}
                        {m.body && <div className="msgr__text">{m.body}</div>}
                      </div>
                      {!mine && <span className="msgr__time">{fmtTime(m.at)}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {err && <div className="notice notice--error" style={{ margin: "0 0 8px" }}>{err}</div>}

      {/* 작성 */}
      <div className="msgr__composer">
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onFile} />
        <button
          type="button"
          className="msgr__attach"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || pending}
          aria-label="사진·영상 첨부"
        >
          {uploading ? "…" : "＋"}
        </button>
        <input
          className="input msgr__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`#${channels.find((c) => c.id === active)?.name ?? ""} 에 메시지`}
        />
        <button type="button" className="btn btn--primary msgr__send" onClick={send} disabled={pending || !input.trim()}>
          전송
        </button>
      </div>

      {lb && <MediaLightbox media={lb} onClose={() => setLb(null)} />}
    </div>
  );
}
