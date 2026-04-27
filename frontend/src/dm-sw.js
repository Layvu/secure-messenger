const CACHE_NAME = 'dm-v1';
const APP_SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        /* TODO: offline install — не критично */
      }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

// Fetch - network-first для навигации, cache-first для статики

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  // Не кэшируем запросы к реле
  if (url.pathname.startsWith('/push/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

// Zero-Knowledge Push - payload всегда пустой, контент расшифровывается в приложении

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('DM', {
      body: 'Новое сообщение',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'dm-new-message',
      renotify: true,
      silent: false,
      data: { action: 'open_latest' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const app = clients.find((c) => c.url.startsWith(self.location.origin));
      if (app) {
        app.postMessage({ type: 'NOTIFICATION_CLICK' });
        return app.focus();
      }
      // Если открытого окна нет - открываем с флагом в URL
      return self.clients.openWindow('/?notification=1');
    }),
  );
});
