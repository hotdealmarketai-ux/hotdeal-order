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

  // 현재 이미지의 확대/팬(줌).
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  // 캐러셀 드래그(좌우 넘기기)와 아래로 밀어 닫기 오프셋.
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [animate, setAnimate] = useState(true);

  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const start = useRef<{ panX: number; panY: number; scale: number; dist: number; cx: number; cy: number } | null>(null);
  const axis = useRef<null | "x" | "y">(null); // 제스처 축 잠금(원본크기)
  const moved = useRef(0);
  const lastTap = useRef(0);
  const vel = useRef(0); // 최근 수평 속도(px/ms) — 살짝 튕겨도 넘어가게(플릭)
  const lastX = useRef(0);
  const lastT = useRef(0);

  const clampIdx = (n: number) => Math.max(0, Math.min(srcs.length - 1, n));
  const go = (dir: number) => {
    setAnimate(true);
    setDragX(0);
    setIdx((i) => clampIdx(i + dir));
  };
  // 사진 넘기면 확대/팬 초기화(넘김 애니메이션은 트랜지션이 처리).
  useEffect(() => {
    setScale(1);
    setPanX(0);
    setPanY(0);
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
    setAnimate(false); // 드래그 중엔 손가락에 딱 붙게(트랜지션 off)
    moved.current = 0;
    axis.current = null;
    vel.current = 0;
    lastX.current = e.clientX;
    lastT.current = e.timeStamp;
    const a = [...ptrs.current.values()];
    if (a.length === 2) {
      start.current = { panX, panY, scale, dist: dist(a[0], a[1]), cx: 0, cy: 0 };
    } else {
      start.current = { panX, panY, scale, dist: 0, cx: e.clientX, cy: e.clientY };
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!isImage || !ptrs.current.has(e.pointerId) || !start.current) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const a = [...ptrs.current.values()];
    if (a.length >= 2) {
      // 핀치 줌
      const d = dist(a[0], a[1]);
      const ns = Math.max(1, Math.min(4, start.current.scale * (d / (start.current.dist || d))));
      const c = clampPan(ns, panX, panY);
      setScale(ns);
      setPanX(c.x);
      setPanY(c.y);
      return;
    }
    const dx = e.clientX - start.current.cx;
    const dy = e.clientY - start.current.cy;
    moved.current = Math.hypot(dx, dy);
    const dt = e.timeStamp - lastT.current;
    if (dt > 0) {
      vel.current = (e.clientX - lastX.current) / dt;
      lastX.current = e.clientX;
      lastT.current = e.timeStamp;
    }
    if (scale > 1) {
      // 확대 상태 → 팬(넘기기·닫기 없음)
      const c = clampPan(scale, start.current.panX + dx, start.current.panY + dy);
      setPanX(c.x);
      setPanY(c.y);
      return;
    }
    // 원본크기: 첫 유의미 이동에서 축 잠금
    if (axis.current === null && moved.current > 8) axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (axis.current === "x") {
      let d = dx;
      const atStart = idx === 0 && d > 0;
      const atEnd = idx === srcs.length - 1 && d < 0;
      if (!many || atStart || atEnd) d = d * 0.32; // 양 끝/단일 = 고무줄 저항
      setDragX(d);
      setDragY(0);
    } else if (axis.current === "y") {
      setDragX(0);
      setDragY(dy > 0 ? dy : 0); // 아래로만(닫기 준비)
    }
  };

  const onUp = (e: React.PointerEvent) => {
    if (!isImage) return;
    ptrs.current.delete(e.pointerId);
    const stillDown = ptrs.current.size > 0;
    if (!stillDown) start.current = null;
    setAnimate(true);
    if (stillDown) return; // 두 손가락 중 하나만 뗌 → 나머지 제스처 유지

    const W = window.innerWidth;
    const H = window.innerHeight;
    if (scale === 1) {
      if (axis.current === "x" && many) {
        // 거리(화면 14%) 또는 빠른 플릭이면 넘어감. dragX<0 = 다음.
        const passDist = Math.abs(dragX) > W * 0.14;
        const passFlick = Math.abs(vel.current) > 0.3 && Math.sign(vel.current) === Math.sign(dragX) && Math.abs(dragX) > 10;
        if ((passDist || passFlick) && dragX !== 0) {
          setIdx((i) => clampIdx(i + (dragX < 0 ? 1 : -1)));
        }
        setDragX(0); // idx 갱신 + dragX 0 → 트랜지션이 부드럽게 스냅
      } else if (axis.current === "y") {
        if (dragY > 90) {
          onClose();
          return;
        }
        setDragY(0);
      } else if (dragX !== 0) {
        setDragX(0);
      }
    }

    // 더블탭 확대/축소
    if (moved.current < 8 && !stillDown) {
      const now = Date.now();
      if (now - lastTap.current < 280) {
        lastTap.current = 0;
        if (scale > 1) {
          setScale(1);
          setPanX(0);
          setPanY(0);
        } else {
          const ns = 2.5;
          const c = clampPan(ns, (W / 2 - e.clientX) * (ns - 1), (H / 2 - e.clientY) * (ns - 1));
          setScale(ns);
          setPanX(c.x);
          setPanY(c.y);
        }
      } else {
        lastTap.current = now;
      }
    }
    axis.current = null;
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

  const dimming = scale === 1 ? Math.max(0.4, 0.95 - Math.abs(dragY) / 600) : 0.95;

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
        <div
          className="lb__track"
          style={{
            transform: `translate3d(calc(${-idx * 100}% + ${dragX}px), ${dragY}px, 0)`,
            transition: animate ? "transform .3s cubic-bezier(.22,.61,.36,1)" : "none",
          }}
        >
          {srcs.map((s, i) => (
            <div className="lb__slide" key={i} style={{ left: `${i * 100}%` }}>
              {Math.abs(i - idx) <= 1 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="lb__img"
                  src={s}
                  alt="첨부 이미지"
                  draggable={false}
                  style={
                    i === idx && scale > 1
                      ? {
                          transform: `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`,
                          transition: animate ? "transform .18s ease" : "none",
                        }
                      : undefined
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <video className="lb__video" src={media.src} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
      )}
    </div>,
    document.body,
  );
}
