"use client";

// 홈 화면에 추가(PWA 설치) 안내 배너.
// - 이미 홈화면에 추가(standalone)면 아무것도 안 뜸.
// - 안 했으면 하단에 "홈 화면에 추가하세요" 배너를 계속 노출(세션당 ✕로 잠시 닫기 가능, 다음 방문에 다시).
// - Android/데스크톱 Chrome: beforeinstallprompt 를 잡아 '추가' 버튼으로 네이티브 설치.
// - iOS 사파리: 프로그램 설치가 불가 → 공유 → '홈 화면에 추가' 수동 안내.

import { useEffect, useState } from "react";

const DISMISS_KEY = "installPromptDismissed"; // 세션 동안만 숨김(다음 방문 때 다시 권유)

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !!displayStandalone || iosStandalone;
}

type Mode = "prompt" | "ios" | "android" | null;

export function InstallPrompt() {
  const [mode, setMode] = useState<Mode>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return; // 이미 홈화면에 추가됨 → 배너 없음
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return; // 이번 세션엔 닫아둠
    } catch {
      /* noop */
    }

    const ua = navigator.userAgent || "";
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isAndroid = /android/i.test(ua);
    let androidTimer: ReturnType<typeof setTimeout> | undefined;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // 브라우저 기본 미니 배너 대신 우리 배너 사용
      setDeferred(e as BeforeInstallPromptEvent);
      setMode("prompt");
      if (androidTimer) clearTimeout(androidTimer);
    };
    const onInstalled = () => {
      setDeferred(null);
      setMode(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    if (isIOS) {
      setMode("ios"); // iOS 는 이벤트가 없으므로 즉시 수동 안내
    } else if (isAndroid) {
      // beforeinstallprompt 가 곧 올 수 있으니 잠깐 기다렸다가, 안 오면 수동 안내로 폴백
      androidTimer = setTimeout(() => {
        if (!isStandalone()) setMode((m) => m ?? "android");
      }, 1600);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (androidTimer) clearTimeout(androidTimer);
    };
  }, []);

  // 배너가 떠 있는 동안 채팅 플로팅 버튼을 배너 위로 올리기 위한 전역 표식
  useEffect(() => {
    const root = document.documentElement;
    if (mode) root.dataset.installbar = "1";
    else delete root.dataset.installbar;
    return () => {
      delete root.dataset.installbar;
    };
  }, [mode]);

  if (!mode) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* noop */
    }
    setMode(null);
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* noop */
    }
    setDeferred(null);
    setMode(null);
  };

  return (
    <div className="installbar" role="dialog" aria-label="홈 화면에 추가 안내">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="installbar__icon" src="/icon-192.png" alt="" width={40} height={40} />
      <div className="installbar__body">
        <div className="installbar__title">홈 화면에 추가하세요</div>
        <div className="installbar__desc">
          {mode === "ios" ? (
            <>
              아래{" "}
              <svg
                className="installbar__share"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3v12" />
                <path d="M8 7l4-4 4 4" />
                <path d="M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7" />
              </svg>{" "}
              공유 버튼을 누르고 <b>‘홈 화면에 추가’</b>를 누르세요.
            </>
          ) : mode === "android" ? (
            <>
              브라우저 <b>⋮</b> 메뉴에서 <b>‘홈 화면에 추가’</b>를 누르세요.
            </>
          ) : (
            <>앱처럼 빠르게 열려요. 오른쪽 ‘추가’를 누르세요.</>
          )}
        </div>
      </div>
      {mode === "prompt" && (
        <button className="installbar__cta" type="button" onClick={install}>
          추가
        </button>
      )}
      <button
        className="installbar__close"
        type="button"
        onClick={dismiss}
        aria-label="닫기"
      >
        ✕
      </button>
    </div>
  );
}
