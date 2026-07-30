"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";

// 전역 실행취소(Ctrl-Z / ⌘-Z) — 자동저장되는 입력(재고 등)을 잘못 고쳤을 때 직전 값으로 되돌린다.
// 각 화면이 useUndo().push(key, run)로 '되돌리기 동작'을 등록하면, 전역 단축키가 최근 것부터 실행.
type UndoApi = { push: (key: string, run: () => void) => void };
const Ctx = createContext<UndoApi | null>(null);

export function useUndo(): UndoApi {
  return useContext(Ctx) ?? { push: () => {} }; // Provider 밖이면 no-op(안전)
}

type Entry = { key: string; ts: number; run: () => void };

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const stack = useRef<Entry[]>([]);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  // 페이지 이동 시 실행취소 기록 초기화 — 다른 화면에서 Ctrl-Z가 이전 화면의 저장을 되살리는 사고 방지.
  useEffect(() => {
    stack.current = [];
  }, [pathname]);

  const push = useCallback((key: string, run: () => void) => {
    const now = Date.now();
    const top = stack.current[stack.current.length - 1];
    // 같은 칸 연속 편집(1.5초 이내)은 하나로 합침 — 처음 값 하나만 보관(한 번에 되돌림).
    if (top && top.key === key && now - top.ts < 1500) {
      top.ts = now;
      return;
    }
    stack.current.push({ key, ts: now, run });
    if (stack.current.length > 200) stack.current.shift();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "z" && e.key !== "Z") || !(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return; // ⇧⌘Z(재실행)·기타 조합은 건드리지 않음
      const entry = stack.current.pop();
      if (!entry) return; // 되돌릴 앱 동작이 없으면 기본(브라우저) 실행취소 그대로
      e.preventDefault();
      try {
        entry.run();
        setToast("실행취소됨");
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 1500);
      } catch {
        /* noop */
      }
    };
    window.addEventListener("keydown", onKey, true); // capture — 입력칸 기본 undo보다 먼저
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className={`undotoast${toast ? " is-on" : ""}`} aria-live="polite">
        ↩ {toast}
      </div>
    </Ctx.Provider>
  );
}
