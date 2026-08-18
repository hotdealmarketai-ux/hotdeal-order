"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 카카오톡식 사진 미리보기(라이트박스). 항상 document.body 로 포탈(조상 transform이 fixed를 가두는 문제 회피 — Sheet와 동일 이유).
// 이미지: 더블탭 확대(1x↔2.5x), 두 손가락 핀치 줌, 확대 시 드래그 팬, 원본크기에서 아래로 밀어 닫기.
// 여러 장(묶음)일 땐 group 으로 넘겨 ‹ › / 키보드 좌우로 넘겨봄.
// 영상: 컨트롤과 함께 중앙 재생.
type Media = { src: string; type: "image" | "video" };

const clampPan = (s: number, x: number, y: number) => {
  const mx = Math.max(0, (s - 1) * window.innerWidth * 0.5) + 40;
  const my = Math.max(0, (s - 1) * window.innerHeight * 0.5) + 40;
  return { x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
};
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export function MediaLightbox({
  media,
  group,
  onClose,
}: {
  media: Media;
  group?: string[]; // 이미지 묶음(있으면 갤러리 네비 표시)
  onClose: () => void;
}) {
  const isImage = media.type === "image";
  const srcs = isImage && group && group.length > 1 ? group : [media.src];
  const [idx, setIdx] = useState(() => {
    const i = srcs.indexOf(media.src);
    return i >= 0 ? i : 0;
  });
  const src = srcs[Math.min(idx, srcs.length - 1)] ?? media.src;
  const many = srcs.length > 1;

  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [animate, setAnimate] = useState(true);

  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const start = useRef<{ tx: number; ty: number; scale: number; dist: number; cx: number; cy: number } | null>(null);
  const moved = useRef(0);
  const lastTap = useRef(0);
  const swipeY = useRef(0);
  const swipeX = useRef(0); // 원본크기에서 좌우로 민 거리(여러 장 넘기기용)

  const go = (dir: number) => {
    setIdx((i) => (srcs.length ? (i + dir + srcs.length) % srcs.length : i));
  };
  // 사진 넘기면 확대/이동 초기화.
  useEffect(() => {
    setScale(1);
    setTx(0);
    setTy(0);
    setAnimate(true);
  }, [idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (many && e.key === "ArrowLeft") go(-1);
      else if (many && e.key === "ArrowRight") go(1);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // 뒤 배경 스크롤 잠금
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, many, srcs.length]);

  const onDown = (e: React.PointerEvent) => {
    if (!isImage) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setAnimate(false);
    moved.current = 0;
    swipeY.current = 0;
    swipeX.current = 0;
    const a = [...ptrs.current.values()];
    if (a.length === 2) {
      start.current = { tx, ty, scale, dist: dist(a[0], a[1]), cx: 0, cy: 0 };
    } else {
      start.current = { tx, ty, scale, dist: 0, cx: e.clientX, cy: e.clientY };
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!isImage || !ptrs.current.has(e.pointerId) || !start.current) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const a = [...ptrs.current.values()];
    if (a.length >= 2) {
      const d = dist(a[0], a[1]);
      const ns = Math.max(1, Math.min(4, start.current.scale * (d / (start.current.dist || d))));
      const c = clampPan(ns, tx, ty);
      setScale(ns);
      setTx(c.x);
      setTy(c.y);
    } else {
      const dx = e.clientX - start.current.cx;
      const dy = e.clientY - start.current.cy;
      moved.current = Math.hypot(dx, dy);
      if (scale > 1) {
        const c = clampPan(scale, start.current.tx + dx, start.current.ty + dy);
        setTx(c.x);
        setTy(c.y);
      } else if (many && Math.abs(dx) > Math.abs(dy)) {
        // 원본크기 + 수평이 우세 → 좌우로 밀어 사진 넘기기
        swipeX.current = dx;
        swipeY.current = 0;
        setTx(dx);
        setTy(0);
      } else if (dy > 0) {
        swipeY.current = dy; // 원본크기에서 아래로 끌기 = 닫기 준비
        swipeX.current = 0;
        setTx(0);
        setTy(dy);
      }
    }
  };

  const onUp = (e: React.PointerEvent) => {
    if (!isImage) return;
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size === 0) start.current = null;
    setAnimate(true);
    // 좌우로 충분히 밀면 사진 넘기기(여러 장일 때). 왼쪽으로 밀면 다음, 오른쪽이면 이전.
    if (scale === 1 && many && Math.abs(swipeX.current) > 55) {
      go(swipeX.current < 0 ? 1 : -1);
      swipeX.current = 0;
      setTx(0);
      setTy(0);
      return;
    }
    if (scale === 1 && swipeX.current !== 0) {
      swipeX.current = 0;
      setTx(0); // 임계 미달 → 제자리
    }
    if (scale === 1 && swipeY.current > 90) {
      onClose();
      return;
    }
    if (scale === 1 && swipeY.current > 0) {
      setTy(0);
      swipeY.current = 0;
    }
    if (moved.current < 8 && ptrs.current.size === 0) {
      const now = Date.now();
      if (now - lastTap.current < 280) {
        lastTap.current = 0;
        if (scale > 1) {
          setScale(1);
          setTx(0);
          setTy(0);
        } else {
          const ns = 2.5;
          const c = clampPan(ns, (window.innerWidth / 2 - e.clientX) * (ns - 1), (window.innerHeight / 2 - e.clientY) * (ns - 1));
          setScale(ns);
          setTx(c.x);
          setTy(c.y);
        }
      } else {
        lastTap.current = now;
      }
    }
  };

  const save = async () => {
    try {
      const r = await fetch(src);
      const b = await r.blob();
      const u = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = u;
      a.download = src.split("/").pop()?.split("?")[0] || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
    } catch {
      window.open(src, "_blank", "noopener");
    }
  };

  const dimming = scale === 1 ? Math.max(0.4, 0.95 - Math.abs(ty) / 600) : 0.95;

  return createPortal(
    <div
      className="lb"
      role="dialog"
      aria-modal="true"
      style={{ background: `rgba(0,0,0,${dimming})`, touchAction: "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClick={(e) => {
        // 배경(이미지 밖) 탭 → 닫기. 확대·드래그 중엔 무시.
        if (e.target === e.currentTarget && scale === 1 && moved.current < 8) onClose();
      }}
    >
      <div className="lb__bar" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        {many && <span className="lb__count">{idx + 1} / {srcs.length}</span>}
        <button type="button" className="lb__btn" onClick={save} aria-label="저장">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="lb__btn" onClick={onClose} aria-label="닫기">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {many && (
        <>
          <button type="button" className="lb__nav lb__nav--prev" aria-label="이전"
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>
          <button type="button" className="lb__nav lb__nav--next" aria-label="다음"
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); go(1); }}>›</button>
        </>
      )}

      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="lb__img"
          src={src}
          alt="첨부 이미지"
          draggable={false}
          style={{
            transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
            transition: animate ? "transform .18s ease" : "none",
          }}
        />
      ) : (
        <video className="lb__video" src={media.src} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
      )}
    </div>,
    document.body,
  );
}
