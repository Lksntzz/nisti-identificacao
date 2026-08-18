import app from './compact-admin-router.js';
import { fastIdentify } from './fast-identify.js';
import { parseSku } from './sku.js';

function responseWithHeaders(response, extra = {}) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
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

async function requireAdmin(request, env, ctx) {
  const sessionUrl = new URL('/api/admin/session', request.url);
  const sessionRequest = new Request(sessionUrl.toString(), {
    method: 'GET',
    headers: request.headers
  });
  const session = await app.fetch(sessionRequest, env, ctx);
  return session.ok;
}

async function updateFinishing(request, env, ctx, productId) {
  if (!(await requireAdmin(request, env, ctx))) {
    return json({ error: 'Sessão administrativa inválida ou expirada.' }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const wireoCode = String(body?.wireo_code || '').trim().toUpperCase();
  const tasselCode = String(body?.tassel_code || '').trim().toUpperCase();
  const elasticoCode = String(body?.elastico_code || '').trim().toUpperCase();

  const product = await env.DB.prepare(`
    SELECT id,sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code
    FROM products WHERE id=? LIMIT 1
  `).bind(productId).first();

  if (!product) return json({ error: 'Produto não encontrado.' }, 404);

  let current;
  try {
    current = parseSku(product.sku);
  } catch {
    return json({ error: 'O SKU atual do produto está inválido e não pode ser sincronizado.' }, 422);
  }

  const nextSku = `${current.mioloCode}_${current.capaCode}_${wireoCode}${tasselCode}${elasticoCode}`;
  let parsed;
  try {
    parsed = parseSku(nextSku);
  } catch (error) {
    return json({ error: error?.message || 'Acabamento inválido.' }, 422);
  }

  const duplicate = await env.DB.prepare(
    `SELECT id FROM products WHERE sku=? AND id<>? LIMIT 1`
  ).bind(parsed.sku, productId).first();

  if (duplicate) {
    return json({ error: `Já existe outro produto cadastrado com o SKU ${parsed.sku}.` }, 409);
  }

  await env.DB.prepare(`
    UPDATE products SET
      sku=?,
      acabamento_code=?,
      wireo_code=?,
      tassel_code=?,
      elastico_code=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    parsed.sku,
    parsed.acabamentoCode,
    parsed.wireoCode,
    parsed.tasselCode,
    parsed.elasticoCode,
    productId
  ).run();

  return json({
    ok: true,
    product: {
      id: productId,
      sku: parsed.sku,
      acabamento_code: parsed.acabamentoCode,
      wireo_code: parsed.wireoCode,
      tassel_code: parsed.tasselCode,
      elastico_code: parsed.elasticoCode,
      wireo: parsed.wireo,
      tassel: parsed.tassel,
      elastico: parsed.elastico
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const finishingMatch = url.pathname.match(/^\/api\/products\/(\d+)\/finishing$/);
    if (finishingMatch && request.method === 'PATCH') {
      return updateFinishing(request, env, ctx, Number(finishingMatch[1]));
    }

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
