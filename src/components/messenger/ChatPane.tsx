"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import {
  sendMessengerMessageAction,
  loadMessengerChannelAction,
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

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(iso));
const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" }).format(new Date(iso));
const dayKey = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);

export function ChatPane({
  me,
  channelId,
  channelName,
}: {
  me: { id: string; name: string };
  channelId: string;
  channelName: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
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

  // 채널 전환 시 초기화 + 폴링(읽음 처리 포함).
  useEffect(() => {
    let alive = true;
    setMessages([]);
    if (!channelId) return;
    const load = async () => {
      const r = await loadMessengerChannelAction(channelId);
      if (!alive) return;
      setMessages((prev) => {
        const same = prev.length === r.messages.length && prev[prev.length - 1]?.id === r.messages[r.messages.length - 1]?.id;
        if (!same) scrollDown();
        return r.messages;
      });
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [channelId]);

  const send = () => {
    const body = input.trim();
    if (!body || !channelId) return;
    setInput("");
    start(async () => {
      const fd = new FormData();
      fd.set("channelId", channelId);
      fd.set("body", body);
      const r = await sendMessengerMessageAction(fd);
      if (r?.error) setErr(r.error);
      const res = await loadMessengerChannelAction(channelId);
      setMessages(res.messages);
      scrollDown();
    });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !channelId) return;
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
      fd.set("channelId", channelId);
      fd.set("body", input.trim());
      fd.set("mediaUrl", blob.url);
      fd.set("mediaType", type);
      setInput("");
      const r = await sendMessengerMessageAction(fd);
      if (r?.error) setErr(r.error);
      const res = await loadMessengerChannelAction(channelId);
      setMessages(res.messages);
      scrollDown();
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : "";
      setErr(msg ? `첨부 실패: ${msg}` : "첨부 전송에 실패했어요.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="chatpane">
      <div className="chatpane__scroll" ref={scrollRef}>
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
              <div key={m.id}>
                {showDay && <div className="chatpane__day">{fmtDay(m.at)}</div>}
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
                            <button type="button" className="media-btn" onClick={() => setLb({ src: m.mediaUrl!, type: "image" })}>
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

      {err && <div className="notice notice--error" style={{ margin: "0 12px 8px" }}>{err}</div>}

      <div className="msgr__composer chatpane__composer">
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onFile} />
        <button type="button" className="msgr__attach" onClick={() => fileRef.current?.click()} disabled={uploading || pending} aria-label="사진·영상 첨부">
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
          placeholder={`#${channelName} 에 메시지`}
        />
        <button type="button" className="btn btn--primary msgr__send" onClick={send} disabled={pending || !input.trim()}>
          전송
        </button>
      </div>

      {lb && <MediaLightbox media={lb} onClose={() => setLb(null)} />}
    </div>
  );
}
