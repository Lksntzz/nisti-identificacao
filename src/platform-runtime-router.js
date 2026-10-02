import app from './edge-router.js';
import { listPlatforms, normalizePlatform } from './platform-scope.js';
import { handlePublicImageRequest } from './public-image-router.js';

function invalidPlatformResponse() {
  return new Response(JSON.stringify({
    error: 'Plataforma inválida. Use MERCADO LIVRE, SHOPEE ou AMAZON.'
  }), {
    status: 400,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function canonicalizeRowPlatform(row) {
  if (!row || typeof row !== 'object') return row;
  const raw = String(row.platform ?? '').trim();
  if (!raw) return row;
  const platform = normalizePlatform(raw);
  if (!platform) return null;
  return { ...row, platform };
}

async function canonicalizeCatalogRequest(request, url) {
  if (request.method !== 'POST') return request;
  const singleProduct = url.pathname === '/api/products';
  const bulkProducts = url.pathname === '/api/admin/bulk-products';
  if (!singleProduct && !bulkProducts) return request;

  const body = await request.clone().json().catch(() => null);
  if (!body || typeof body !== 'object') return request;

  if (singleProduct) {
    const normalized = canonicalizeRowPlatform(body);
    if (!normalized) return invalidPlatformResponse();
    Object.assign(body, normalized);
  }

  if (bulkProducts && Array.isArray(body.rows)) {
    const rows = [];
    for (const row of body.rows) {
      const normalized = canonicalizeRowPlatform(row);
      if (!normalized) return invalidPlatformResponse();
      rows.push(normalized);
    }
    body.rows = rows;
  }

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body)
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const publicImageResponse = await handlePublicImageRequest(request, env);
    if (publicImageResponse) return publicImageResponse;

    if (request.method === 'GET' && url.pathname === '/api/platforms') {
      const platforms = await listPlatforms(env);
      return new Response(JSON.stringify({ ok: true, platforms }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        }
      });
    }

    const canonicalRequest = await canonicalizeCatalogRequest(request, url);
    if (canonicalRequest instanceof Response) return canonicalRequest;
    return app.fetch(canonicalRequest, env, ctx);
  }
};