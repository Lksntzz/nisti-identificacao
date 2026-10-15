const CACHE_NAME = 'nisti-id-v40';
const SHELL_KEY = '/__nisti_shell__';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
    // Never force open screens to reload: scanners, forms and draft posts may be active.
    // Newly opened navigations use the newly activated worker automatically.
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
        // Only cache the public operator shell. Never save protected login or
        // personalized responses as an offline fallback.
        if (url.pathname === '/' && response.ok && response.headers.get('content-type')?.includes('text/html')) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(SHELL_KEY, response.clone());
        }
        return response;
      } catch (error) {
        if (url.pathname === '/') {
          const cached = await caches.match(SHELL_KEY);
          if (cached) return cached;
        }
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
      const keyResponse = await fetch('/api/push/public-key', { cache: 'no-store' });
      if (!keyResponse.ok) throw new Error('VAPID public key indisponível');
      const { publicKey } = await keyResponse.json();
      const subscription = event.newSubscription || await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: pushApplicationServerKey(publicKey)
      });
      const serialized = subscription.toJSON();
      const saved = await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: serialized })
      });
      if (!saved.ok || (await saved.json().catch(() => null))?.ok !== true) {
        throw new Error('Servidor não confirmou a nova assinatura push');
      }
      if (event.oldSubscription?.endpoint && event.oldSubscription.endpoint !== subscription.endpoint) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: event.oldSubscription.endpoint })
        }).catch(() => null);
      }
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
      mural_post_id: data.mural_post_id,
      channel: data.channel === 'mural' ? 'mural' : 'scanner',
      mural_kind: data.mural_kind
    }
  };

  event.waitUntil((async () => {
    let displayStatus = 'failed';
    try {
      await self.registration.showNotification(title, options);
      displayStatus = 'shown';
    } catch (error) {
      console.error('[Push] O dispositivo recusou exibir a notificação:', error?.message || String(error));
    }
    // Acknowledgement is only sent for an explicit single-device QA test.
    // It never enables the public Mural or marks a publication as read.
    if (data.channel === 'mural' && data.mural_kind === 'test'
      && /^[0-9a-f-]{36}$/i.test(String(data.push_test_id || ''))) {
      try {
        await fetch('/api/push/test-receipt', {
          method:'POST', credentials:'same-origin',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({test_id:data.push_test_id,display_status:displayStatus})
        });
      } catch (error) {
        console.warn('[Push QA] Confirmação de exibição indisponível', error?.message || String(error));
      }
    }
  })());
});

// Local presentation check: no server push, no account broadcast and no
// sensitive data. Lets operators distinguish OS permissions from gateway issues.
self.addEventListener('message', event => {
  if (event.data?.type !== 'nisti-local-notification-test') return;
  const port = event.ports?.[0];
  event.waitUntil((async () => {
    try {
      await self.registration.showNotification('Teste local · NISTI', {
        body:'Seu celular consegue exibir notificações do aplicativo NISTI.',
        icon:new URL('/nisti-logo.png',self.location.origin).href,
        badge:new URL('/nisti-logo.png',self.location.origin).href,
        tag:'nisti-local-test',
        renotify:true,
        data:{url:'/#scanner'}
      });
      port?.postMessage({ok:true});
    } catch (error) {
      port?.postMessage({ok:false,error:'O celular não permitiu exibir a notificação.'});
    }
  })());
});

function safeNotificationTarget(value) {
  try {
    const target = new URL(String(value || '/'), self.location.origin);
    if (target.origin !== self.location.origin) return '/';
    if (!target.pathname.startsWith('/')) return '/';
    return target.pathname + target.search + target.hash;
  } catch {
    return '/';
  }
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = safeNotificationTarget(event.notification.data?.url);

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = new URL(targetUrl, self.location.origin).href;
    const operatorClient = allClients.find(client => {
      try { return new URL(client.url).pathname === '/' && 'focus' in client; }
      catch { return false; }
    });
    if (operatorClient) {
      const navigated = 'navigate' in operatorClient
        ? await operatorClient.navigate(target).catch(() => null)
        : null;
      await (navigated || operatorClient).focus();
      return;
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(target);
    }
  })());
});
