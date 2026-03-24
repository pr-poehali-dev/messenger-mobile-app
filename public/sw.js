// ─── Каспер Service Worker ────────────────────────────────────────────────────
// Обновляй BUILD_TIME при каждом деплое чтобы инвалидировать кэш у всех
const BUILD_TIME = "20260324-v5";
const CACHE_APP = `kasper-app-${BUILD_TIME}`;
const CACHE_ASSETS = `kasper-assets-${BUILD_TIME}`;
const APP_ICON = "https://cdn.poehali.dev/projects/84792fb2-1985-42c4-8056-a4e27799a11a/bucket/2069fcb7-f721-4674-b0d8-51603e738767.png";

// Ресурсы APP-шелла — предзагружаем при установке
const APP_SHELL = [
  "/",
  "/index.html",
];

// Домены, запросы к которым НИКОГДА не кэшируем (API)
const NO_CACHE_HOSTS = [
  "functions.poehali.dev",
  "mc.yandex.ru",
  "cdn.poehali.dev",
];

// ── Install: предзагружаем шелл ───────────────────────────────────────────────
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(c => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // не падаем если нет сети
  );
});

// ── Activate: удаляем старые кэши ─────────────────────────────────────────────
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_APP && k !== CACHE_ASSETS)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: стратегия по типу ресурса ──────────────────────────────────────────
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // API и внешние сервисы — всегда сеть, никогда кэш
  if (NO_CACHE_HOSTS.some(h => url.hostname.includes(h))) return;

  // Навигация (HTML) — Network First, фоллбэк на кэш
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            caches.open(CACHE_APP).then(c => c.put(req, res.clone()));
          }
          return res;
        })
        .catch(() =>
          caches.match("/index.html").then(cached => cached || new Response("Нет сети", { status: 503 }))
        )
    );
    return;
  }

  // JS/CSS/шрифты — Cache First (долгоживущие ресурсы)
  const isStaticAsset = /\.(js|css|woff2?|ttf|otf)(\?.*)?$/.test(url.pathname);
  if (isStaticAsset) {
    e.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res.ok) caches.open(CACHE_ASSETS).then(c => c.put(req, res.clone()));
          return res;
        });
      })
    );
    return;
  }

  // Остальное (картинки и т.п.) — Stale While Revalidate
  e.respondWith(
    caches.open(CACHE_ASSETS).then(cache =>
      cache.match(req).then(cached => {
        const fetchPromise = fetch(req).then(res => {
          if (res.ok && res.type !== "opaque") cache.put(req, res.clone());
          return res;
        }).catch(() => cached || Response.error());
        return cached || fetchPromise;
      })
    )
  );
});

// ── Настройки уведомлений (синхронизируются из приложения) ───────────────────
let swSettings = { bg_notif: true, preview: true, msg_sound: true };

self.addEventListener("message", e => {
  if (e.data && e.data.type === "UPDATE_NOTIF_SETTINGS") {
    Object.assign(swSettings, e.data.settings);
  }
});

// ── Push: показываем уведомление ──────────────────────────────────────────────
self.addEventListener("push", e => {
  if (!e.data) return;

  let payload = {};
  try { payload = e.data.json(); } catch { payload = { title: "Каспер", body: e.data.text() }; }

  const isCall = payload.type === "call";

  // Фоновые уведомления сообщений можно отключить, звонки — никогда
  if (!isCall && !swSettings.bg_notif) return;

  const silent = !swSettings.msg_sound && !isCall;
  const body = (!isCall && !swSettings.preview) ? "Новое сообщение" : (payload.body || "Новое сообщение");

  const notifOptions = {
    body,
    icon: APP_ICON,
    badge: APP_ICON,
    tag: payload.tag || "kasper-msg",
    renotify: true,
    silent,
    data: { url: payload.url || "/", type: payload.type || "message" },
    vibrate: isCall ? [300, 100, 300, 100, 300] : (silent ? [] : [100, 50, 100]),
    actions: isCall
      ? [{ action: "open", title: "Ответить" }, { action: "close", title: "Отклонить" }]
      : [{ action: "open", title: "Открыть" }, { action: "close", title: "Закрыть" }],
  };

  // Звонки держим на экране пока пользователь не отреагирует
  if (isCall) notifOptions.requireInteraction = true;

  e.waitUntil(self.registration.showNotification(payload.title || "Каспер", notifOptions));
});

// ── Клик по уведомлению ───────────────────────────────────────────────────────
self.addEventListener("notificationclick", e => {
  e.notification.close();
  if (e.action === "close") return;

  const url = e.notification.data?.url || "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      // Фокусируем существующую вкладку
      const existing = list.find(c => c.url.startsWith(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate(url);
        return;
      }
      return clients.openWindow(url);
    })
  );
});

// ── Background Sync (для офлайн-сообщений) ────────────────────────────────────
self.addEventListener("sync", e => {
  if (e.tag === "sync-messages") {
    e.waitUntil(
      // Просто уведомляем клиент что нужно синхронизироваться
      clients.matchAll({ type: "window" }).then(list =>
        Promise.all(list.map(c => c.postMessage({ type: "SYNC_REQUIRED" })))
      )
    );
  }
});