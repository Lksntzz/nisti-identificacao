const CACHE_NAME = 'nisti-id-v38';
const SHELL_KEY = '/__nisti_shell__';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map(client => client.navigate(client.url).catch(() => null)));
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

function pushApplicationServerKey(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const raw = atob((base64String + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      if (event.oldSubscription?.endpoint) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: event.oldSubscription.endpoint })
        }).catch(() => null);
      }

      const keyResponse = await fetch('/api/push/public-key', { cache: 'no-store' });
      if (!keyResponse.ok) throw new Error('VAPID public key indisponível');
      const { publicKey } = await keyResponse.json();
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: pushApplicationServerKey(publicKey)
      });
      const serialized = subscription.toJSON();
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: serialized })
      });
    } catch (error) {
      console.error('[Push] Falha ao renovar assinatura em background', error);
    }
  })());
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
    icon: new URL('/nisti-logo.png', self.location.origin).href,
    badge: new URL('/nisti-logo.png', self.location.origin).href,
    image: data.image_url || undefined,
    tag: data.capa_code
      ? `capa-${data.capa_code}`
      : data.mural_post_id
        ? `mural-${data.mural_post_id}`
        : `nisti-${Date.now()}`,
    renotify: true,
    timestamp: Date.now(),
    data: {
      url: data.url || '/',
      capa_code: data.capa_code,
      mural_post_id: data.mural_post_id
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
