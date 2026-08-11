"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { adminListMerchants, sendBroadcast } from "@/app/actions/chat";

const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // 100MB

type Merchant = { id: string; storeName: string };
type Media = { url: string; type: "image" | "video" };

// #4 전체공지 — 관리자가 가맹점을 골라(모두선택/해제 토글) 메시지·사진·영상을 일괄 발송.
export function BroadcastModal({ onClose }: { onClose: () => void }) {
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [media, setMedia] = useState<Media | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await adminListMerchants().catch(() => null);
      if (!cancelled) setMerchants(list ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allSelected =
    !!merchants && merchants.length > 0 && selected.size === merchants.length;

  const toggleAll = () => {
    if (!merchants) return;
    setSelected(allSelected ? new Set() : new Set(merchants.map((m) => m.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_MEDIA_BYTES) {
      setErr("100MB 이하 파일만 첨부할 수 있어요.");
      return;
    }
    const type: "image" | "video" = file.type.startsWith("video")
      ? "video"
      : "image";
    setUploading(true);
    setErr("");
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/chat/upload",
        contentType: file.type || undefined,
      });
      setMedia({ url: blob.url, type });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setErr(msg ? `첨부 실패: ${msg}` : "첨부 업로드에 실패했어요. 사진·영상 저장소 설정을 확인해 주세요.");
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    if (selected.size === 0) {
      setErr("보낼 지점을 선택하세요.");
      return;
    }
    if (!message.trim() && !media) {
      setErr("메시지나 사진·영상을 입력하세요.");
      return;
    }
    setSending(true);
    setErr("");
    const res = await sendBroadcast(
      Array.from(selected),
      message.trim(),
      media,
    );
    setSending(false);
    if (!res.ok) {
      setErr(res.error || "전송에 실패했어요.");
      return;
    }
    setDoneCount(res.count ?? selected.size);
  };

  return (
    <div className="bcast-overlay" role="dialog" aria-modal="true">
      <div className="bcast">
        <div className="bcast__head">
          <div className="bcast__title">📢 전체공지</div>
          <button className="bcast__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        {doneCount !== null ? (
          <div className="bcast__done">
            <div className="bcast__doneicon">✓</div>
            <div className="bcast__donetext">
              {doneCount}개 지점에 공지를 보냈어요.
            </div>
            <button className="btn btn--primary" onClick={onClose}>
              확인
            </button>
          </div>
        ) : (
          <>
            <div className="bcast__body">
              <div className="bcast__seclabel">
                <span>받을 지점</span>
                {merchants && merchants.length > 0 && (
                  <button
                    type="button"
                    className="bcast__toggleall"
                    onClick={toggleAll}
                  >
                    {allSelected ? "모두 해제" : "모두 선택"}
                  </button>
                )}
              </div>

              {merchants === null ? (
                <div className="bcast__loading">불러오는 중…</div>
              ) : merchants.length === 0 ? (
                <div className="bcast__loading">가입된 가맹점이 없어요.</div>
              ) : (
                <div className="bcast__list">
                  {merchants.map((m) => {
                    const on = selected.has(m.id);
                    return (
                      <button
                        type="button"
                        key={m.id}
                        className={`bcast__item${on ? " is-on" : ""}`}
                        onClick={() => toggleOne(m.id)}
                      >
                        <span className={`bcast__check${on ? " is-on" : ""}`}>
                          {on ? "✓" : ""}
                        </span>
                        <span className="bcast__store">{m.storeName}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="bcast__seclabel" style={{ marginTop: 14 }}>
                <span>내용</span>
                <span className="bcast__count">{selected.size}곳 선택</span>
              </div>
              <textarea
                className="bcast__textarea"
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (err) setErr("");
                }}
                placeholder="공지 내용을 입력하세요…"
                maxLength={2000}
                rows={4}
              />

              {media && (
                <div className="bcast__preview">
                  {media.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={media.url} alt="첨부 미리보기" />
                  ) : (
                    <video src={media.url} controls preload="metadata" playsInline />
                  )}
                  <button
                    type="button"
                    className="bcast__removemedia"
                    onClick={() => setMedia(null)}
                    aria-label="첨부 제거"
                  >
                    ✕
                  </button>
                </div>
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                hidden
                onChange={onFileChange}
              />
              <button
                type="button"
                className="bcast__attach"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "업로드 중…" : media ? "사진·영상 변경" : "📷 사진·영상 첨부"}
              </button>

              {err && <div className="bcast__err">{err}</div>}
            </div>

            <div className="bcast__foot">
              <button className="btn btn--ghost" onClick={onClose}>
                취소
              </button>
              <button
                className="btn btn--primary"
                onClick={send}
                disabled={sending || uploading}
              >
                {sending ? "보내는 중…" : "전송"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
