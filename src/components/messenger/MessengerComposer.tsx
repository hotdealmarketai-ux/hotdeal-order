"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Member = { id: string; name: string; active: boolean };
type ReplyTo = { id: string; name: string; body: string };

// 입력창을 별도 컴포넌트로 분리 — 타이핑이 메시지 목록(수백 개)을 리렌더하지 않게 해 입력을 부드럽게.
export function MessengerComposer({
  members,
  replyTo,
  onClearReply,
  onSend,
  onFiles,
  uploading,
}: {
  members: Member[];
  replyTo: ReplyTo | null;
  onClearReply: () => void;
  onSend: (text: string) => void;
  onFiles: (files: File[]) => void;
  uploading: boolean;
}) {
  const [input, setInput] = useState("");
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeMembers = useMemo(() => members.filter((m) => m.active), [members]);

  // 답장 시작 시 입력창 포커스(꾹 눌러 '댓글' 후 바로 타이핑).
  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInput(v);
    const caret = e.target.selectionStart ?? v.length;
    const upto = v.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /\s/.test(upto[at - 1]))) {
      const query = upto.slice(at + 1);
      if (!/\s/.test(query)) {
        setMention({ query, start: at });
        return;
      }
    }
    setMention(null);
  };
  const pick = (name: string) => {
    if (!mention) return;
    const before = input.slice(0, mention.start);
    const after = input.slice(inputRef.current?.selectionStart ?? input.length);
    const next = `${before}@${name} ${after}`;
    setInput(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = (before + `@${name} `).length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };
  const list = mention
    ? activeMembers.filter((m) => m.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6)
    : [];

  const submit = () => {
    const t = input.trim();
    if (!t) return;
    onSend(t);
    setInput("");
    setMention(null);
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) onFiles(files);
  };

  return (
    <>
      {replyTo && (
        <div className="chatpane__reply">
          <div className="chatpane__replymain">
            <span className="chatpane__replyname">{replyTo.name}에게 답장</span>
            <span className="chatpane__replybody">{replyTo.body}</span>
          </div>
          <button type="button" className="chatpane__replyx" onClick={onClearReply} aria-label="답장 취소">✕</button>
        </div>
      )}
      <div className="msgr__composer chatpane__composer">
        {mention && list.length > 0 && (
          <div className="chatpane__mentions">
            {list.map((m) => (
              <button key={m.id} type="button" className="chatpane__mentionitem" onClick={() => pick(m.name)}>
                <span className="chatpane__mentionava">{m.name.slice(0, 1)}</span>
                {m.name}
              </button>
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={onFile} />
        <button type="button" className="msgr__attach" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="사진·영상 첨부">
          {uploading ? "…" : "＋"}
        </button>
        <input
          ref={inputRef}
          className="input msgr__input"
          value={input}
          onChange={onChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (mention && list.length > 0) pick(list[0].name);
              else submit();
            }
            if (e.key === "Escape") setMention(null);
          }}
          placeholder=""
        />
        <button type="button" className="btn btn--primary msgr__send" onClick={submit} disabled={!input.trim()}>
          전송
        </button>
      </div>
    </>
  );
}
