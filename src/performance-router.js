import app from './compact-admin-router.js';
import { fastIdentify } from './fast-identify.js';

function responseWithHeaders(response, extra = {}) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}

function versionedImageUrl(rawUrl, requestUrl, imageKey) {
  const target = new URL(rawUrl, requestUrl);
  const version = String(imageKey || '').split('/').pop() || 'current';
  target.searchParams.set('v', version);
  return target;
}

async function cacheImageRequest(request, env, ctx) {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  const origin = await app.fetch(request, env, ctx);
  if (!origin.ok) return origin;

  const headers = responseWithHeaders(origin, {
    'cache-control': 'public, max-age=2592000, immutable',
    'cdn-cache-control': 'public, max-age=2592000'
  });
  const response = new Response(origin.body, {
    status: origin.status,
    statusText: origin.statusText,
    headers
  });

  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

async function warmIdentifiedImage(url, env, ctx) {
  const request = new Request(url.toString(), { method: 'GET' });
  const cache = caches.default;
  if (await cache.match(request)) return;

  const origin = await app.fetch(request, env, ctx);
  if (!origin.ok) return;

  const headers = responseWithHeaders(origin, {
    'cache-control': 'public, max-age=2592000, immutable',
    'cdn-cache-control': 'public, max-age=2592000'
  });
  const response = new Response(origin.body, {
    status: origin.status,
    statusText: origin.statusText,
    headers
  });
  await cache.put(request, response);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && /^\/api\/images\/\d+$/.test(url.pathname) && url.searchParams.has('v')) {
      return cacheImageRequest(request, env, ctx);
    }

    if (request.method === 'POST' && url.pathname === '/api/identify') {
      const response = await fastIdentify(request, env);
      if (!response.ok) return response;

      const type = response.headers.get('content-type') || '';
      if (!type.includes('application/json')) return response;

      const data = await response.clone().json().catch(() => null);
      if (!data?.product) return response;

      if (data.product.image_url && data.product.image_key) {
        const imageUrl = versionedImageUrl(data.product.image_url, request.url, data.product.image_key);
        data.product.image_url = `${imageUrl.pathname}${imageUrl.search}`;
        ctx.waitUntil(warmIdentifiedImage(imageUrl, env, ctx));
      }

      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: responseWithHeaders(response)
      });
    }

    return app.fetch(request, env, ctx);
  }
};
