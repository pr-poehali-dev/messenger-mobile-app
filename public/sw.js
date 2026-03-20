const CACHE = "kasper-v1";
const APP_ICON = "https://cdn.poehali.dev/projects/84792fb2-1985-42c4-8056-a4e27799a11a/bucket/2069fcb7-f721-4674-b0d8-51603e738767.png";

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(["/", "/index.html"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.hostname.includes("functions.poehali.dev") || url.hostname.includes("mc.yandex.ru")) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && res.type !== "opaque") {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(cached => cached || caches.match("/index.html"))
      )
  );
});

self.addEventListener("push", e => {
  if (!e.data) return;
  let payload = {};
  try { payload = e.data.json(); } catch { payload = { title: "Каспер", body: e.data.text() }; }

  e.waitUntil(
    self.registration.showNotification(payload.title || "Каспер", {
      body: payload.body || "Новое сообщение",
      icon: APP_ICON,
      badge: APP_ICON,
      tag: payload.tag || "kasper-msg",
      renotify: true,
      data: { url: payload.url || "/" },
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
