self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  const title = data.title || 'Новое сообщение';
  const options = {
    body: data.body || '',
    icon: '/webapp/favicon.svg',
    badge: '/webapp/favicon.svg',
    tag: data.tag || 'pulse-msg',
    renotify: true,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
