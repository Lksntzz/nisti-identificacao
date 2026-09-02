import app from './edge-router.js';
import { buildVectorizeTop1Candidates } from './vectorize-top1-candidates.js';
import { structuralFinalIdentifyV8 } from './structural-final-v8.js';
import { tryRetrievalFastPath } from './retrieval-fastpath.js';
import { handleRetrievalBenchmarkRequest } from './retrieval-benchmark.js';
import { recordRecognitionAttempt } from './recognition-metrics.js';
import { listPlatforms, normalizePlatform } from './platform-scope.js';
import { handlePublicImageRequest } from './public-image-router.js';
import { handleOccurrencesAdminRequest } from './occurrences-router.js';

const RECOGNITION_COOKIE = 'nisti_recognition_ticket';

async function recordFallback(ctx, env, response, request) {
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json')
    ? await response.clone().json().catch(() => null)
    : null;
  if (!data) return;

  let operatorName = null;
  const rawOpName = request?.headers?.get('x-operator-name');
  if (rawOpName) {
    try { operatorName = decodeURIComponent(rawOpName); } catch { operatorName = rawOpName; }
  }
  const operatorId = request?.headers?.get('x-operator-id') || request?.headers?.get('x-user-id') || null;

  const telemetry = recordRecognitionAttempt(env, response.status, data, { operatorName, operatorId });
  if (ctx?.waitUntil) ctx.waitUntil(telemetry);
  else await telemetry;
}

async function withRecognitionTicketCookie(response) {
  if (!response?.ok) return response;
  const data = await response.clone().json().catch(() => null);
  if (!data?.ticket) return response;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.append(
    'set-cookie',
    `${RECOGNITION_COOKIE}=${data.ticket}; Path=/api; Max-Age=150; HttpOnly; Secure; SameSite=Lax`
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

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

    const benchmarkResponse = await handleRetrievalBenchmarkRequest(request, env);
    if (benchmarkResponse) return benchmarkResponse;

    const occurrencesResponse = await handleOccurrencesAdminRequest(request, env);
    if (occurrencesResponse) return occurrencesResponse;

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

    if (request.method === 'POST' && url.pathname === '/api/identify-candidates') {
      const response = await buildVectorizeTop1Candidates(request, env);
      return withRecognitionTicketCookie(response);
    }

    if (request.method === 'POST' && url.pathname === '/api/identify') {
      const fastResponse = await tryRetrievalFastPath(request.clone(), env);
      const response = fastResponse || await structuralFinalIdentifyV8(request, env);
      await recordFallback(ctx, env, response, request);
      return response;
    }

    if (request.method === 'POST' && url.pathname === '/api/identify-detail') {
      const { identifyProductByDetail } = await import('./structural-final-v8.js');
      return identifyProductByDetail(request, env);
    }

    const canonicalRequest = await canonicalizeCatalogRequest(request, url);
    if (canonicalRequest instanceof Response) return canonicalRequest;
    return app.fetch(canonicalRequest, env, ctx);
  }
};