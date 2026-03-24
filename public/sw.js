// ─── Каспер Service Worker ────────────────────────────────────────────────────
// Обновляй BUILD_TIME при каждом деплое чтобы инвалидировать кэш у всех
const BUILD_TIME = "20260324-v6";
const CACHE_APP = `kasper-app-${BUILD_TIME}`;
const CACHE_ASSETS = `kasper-assets-${BUILD_TIME}`;
const APP_ICON = "https://cdn.poehali.dev/projects/84792fb2-1985-42c4-8056-a4e27799a11a/bucket/2069fcb7-f721-4674-b0d8-51603e738767.png";
const CALLS_URL = "https://functions.poehali.dev/ec19ea73-ee73-48c3-a4cc-a6104054ed8e";

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

// Активные звонки: call_id → intervalId (для повторной вибрации)
const activeCallTimers = new Map();

// ── Install: предзагружаем шелл ───────────────────────────────────────────────
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(c => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
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
// Токен авторизации (передаётся из приложения для decline-звонков из SW)
let swAuthToken = "";

self.addEventListener("message", e => {
  if (!e.data) return;
  if (e.data.type === "UPDATE_NOTIF_SETTINGS") {
    Object.assign(swSettings, e.data.settings);
  }
  if (e.data.type === "UPDATE_AUTH_TOKEN") {
    swAuthToken = e.data.token || "";
  }
  // Звонок завершён/принят — остановить повторные уведомления
  if (e.data.type === "CALL_ENDED" || e.data.type === "CALL_ANSWERED") {
    const callId = e.data.call_id;
    if (callId && activeCallTimers.has(callId)) {
      clearInterval(activeCallTimers.get(callId));
      activeCallTimers.delete(callId);
    }
    // Закрываем уведомление о звонке
    self.registration.getNotifications({ tag: `call-${callId}` })
      .then(notifs => notifs.forEach(n => n.close()));
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

  if (isCall) {
    const callId = payload.call_id;
    e.waitUntil(showCallNotification(payload, callId));
  } else {
    const notifOptions = {
      body,
      icon: APP_ICON,
      badge: APP_ICON,
      tag: payload.tag || "kasper-msg",
      renotify: true,
      silent,
      data: { url: payload.url || "/", type: "message" },
      vibrate: silent ? [] : [100, 50, 100],
      actions: [
        { action: "open", title: "Открыть" },
        { action: "close", title: "Закрыть" },
      ],
    };
    e.waitUntil(self.registration.showNotification(payload.title || "Каспер", notifOptions));
  }
});

// ── Показ уведомления о звонке с повторной вибрацией ─────────────────────────
function showCallNotification(payload, callId) {
  const notifOptions = {
    body: payload.body || "Входящий звонок",
    icon: APP_ICON,
    badge: APP_ICON,
    tag: payload.tag || `call-${callId}`,
    renotify: true,
    silent: false,
    data: {
      url: payload.url || "/",
      type: "call",
      call_id: callId,
      caller_name: payload.title,
    },
    vibrate: [500, 200, 500, 200, 500],
    actions: [
      { action: "answer", title: "✅ Ответить" },
      { action: "decline", title: "❌ Отклонить" },
    ],
    requireInteraction: true,
  };

  // Запускаем повторную вибрацию каждые 3 секунды пока звонок активен
  if (callId && !activeCallTimers.has(callId)) {
    const timerId = setInterval(() => {
      // Проверяем что уведомление ещё показано
      self.registration.getNotifications({ tag: `call-${callId}` }).then(notifs => {
        if (notifs.length === 0) {
          // Уведомление закрыто — стопаем таймер
          clearInterval(timerId);
          activeCallTimers.delete(callId);
          return;
        }
        // Обновляем уведомление (renotify: true) — триггерит вибрацию снова
        self.registration.showNotification(notifOptions.data.caller_name || "Каспер", {
          ...notifOptions,
          renotify: true,
        });
      });
    }, 4000);
    activeCallTimers.set(callId, timerId);

    // Авто-стоп через 60 секунд (звонок точно истёк)
    setTimeout(() => {
      if (activeCallTimers.has(callId)) {
        clearInterval(activeCallTimers.get(callId));
        activeCallTimers.delete(callId);
        self.registration.getNotifications({ tag: `call-${callId}` })
          .then(notifs => notifs.forEach(n => n.close()));
      }
    }, 60000);
  }

  return self.registration.showNotification(payload.title || "Каспер", notifOptions);
}

// ── Клик по уведомлению ───────────────────────────────────────────────────────
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const notifData = e.notification.data || {};
  const isCall = notifData.type === "call";
  const callId = notifData.call_id;
  const action = e.action;

  // Остановить повторные уведомления звонка
  if (isCall && callId && activeCallTimers.has(callId)) {
    clearInterval(activeCallTimers.get(callId));
    activeCallTimers.delete(callId);
  }

  if (isCall && action === "decline") {
    // Отклонить звонок прямо из уведомления (без открытия приложения)
    e.waitUntil(
      declineCallFromSW(callId).then(() => {
        // Уведомляем открытые вкладки что звонок отклонён
        return clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
          list.forEach(c => c.postMessage({ type: "CALL_DECLINED_FROM_SW", call_id: callId }));
        });
      })
    );
    return;
  }

  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.startsWith(self.location.origin));
      if (existing) {
        existing.focus();
        if (isCall) {
          const msgType = action === "answer" ? "CALL_ANSWER_FROM_SW" : "CALL_NOTIFICATION_CLICKED";
          existing.postMessage({ type: msgType, call_id: callId });
        }
        return;
      }
      // Открываем приложение если закрыто
      return clients.openWindow(notifData.url || "/").then(client => {
        if (client && isCall) {
          const msgType = action === "answer" ? "CALL_ANSWER_FROM_SW" : "CALL_NOTIFICATION_CLICKED";
          setTimeout(() => client.postMessage({ type: msgType, call_id: callId }), 2000);
        }
      });
    })
  );
});

// ── Отклонить звонок прямо из SW (fetch к бэкенду) ───────────────────────────
async function declineCallFromSW(callId) {
  if (!swAuthToken || !callId) return;
  try {
    await fetch(CALLS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": swAuthToken,
      },
      body: JSON.stringify({ action: "decline", call_id: callId }),
    });
  } catch (err) {
    console.error("[SW] decline fetch error:", err);
  }
}

// ── Background Sync (для офлайн-сообщений) ────────────────────────────────────
self.addEventListener("sync", e => {
  if (e.tag === "sync-messages") {
    e.waitUntil(
      clients.matchAll({ type: "window" }).then(list =>
        Promise.all(list.map(c => c.postMessage({ type: "SYNC_REQUIRED" })))
      )
    );
  }
});
