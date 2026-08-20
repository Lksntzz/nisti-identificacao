const CACHE_NAME = 'nisti-id-v24';
const SHELL_KEY = '/__nisti_shell__';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if ((url.pathname.startsWith('/api/images/') || url.pathname.startsWith('/api/reference-images/')) && url.searchParams.has('v')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(SHELL_KEY, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await caches.match(SHELL_KEY);
        if (cached) return cached;
        throw error;
      }
    })());
  }
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'NISTI ID', body: event.data ? event.data.text() : 'Nova notificação de capa' };
  }

  const title = data.title || '🔔 Nova Capa Cadastrada · NISTI ID';
  const options = {
    body: data.body || 'Uma nova capa foi adicionada ao catálogo.',
    icon: '/nisti-app-icon.svg',
    badge: '/nisti-app-icon.svg',
    image: data.image_url || undefined,
    tag: data.capa_code ? `capa-${data.capa_code}` : 'nisti-new-cover',
    renotify: true,
    data: {
      url: data.url || '/',
      capa_code: data.capa_code
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        client.focus();
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});