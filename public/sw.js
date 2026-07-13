// 핫딜오더 푸시 전용 서비스워커 — 캐싱 일절 안 함(데이터 항상 최신).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "핫딜오더";
  const url = data.url || "/";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url },
    vibrate: [80, 40, 80],
  };
  // OS 알림은 항상 띄우고(앱이 꺼져있든 켜져있든), 동시에 열려있는(포그라운드) 앱에도
  // 메시지를 보내 인앱 배너 + 알림배지 새로고침을 하게 한다. #10 (앱 켜져 있을 때도 알림 보이게)
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((list) => {
          for (const client of list) {
            client.postMessage({
              kind: "push",
              title,
              body: options.body,
              url,
              type: data.type || "",
            });
          }
        }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
  );
});
