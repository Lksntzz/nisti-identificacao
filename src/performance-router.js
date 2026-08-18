import app from './edge-router.js';
import { fastIdentify } from './fast-identify-v4.js';
import { buildLocalVisionCandidates, confirmLocalVision } from './embedding-candidates.js';
import { recordRecognitionAttempt } from './recognition-metrics.js';

// O fluxo principal usa embedding + visão local. O fallback generativo fica
// disponível apenas para compatibilidade e não é mais interrompido em 5 s.
const FALLBACK_MAX_MS = 20_000;

function responseWithHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

function resultImageUrl(product) {
  if (!product?.id || !product?.image_key) return null;
  const version = String(product.image_key).split('/').pop() || 'current';
  return `/api/images/${product.id}?v=${encodeURIComponent(version)}`;
}

function prepareProductImage(product) {
  if (!product?.image_key) return product;
  product.image_url = resultImageUrl(product);
  return product;
}

async function readJson(response) {
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json')
    ? response.clone().json().catch(() => null)
    : null;
}

async function record(ctx, env, response, data) {
  if (!data) return;
  const telemetry = recordRecognitionAttempt(env, response.status, data);
  if (ctx?.waitUntil) ctx.waitUntil(telemetry);
  else await telemetry;
}

async function identifyFallback(request, env) {
  const started = Date.now();
  const response = await fastIdentify(request, env, {
    deadlineAt: started + FALLBACK_MAX_MS
  });
  const data = await readJson(response);
  return { response, data };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/identify-candidates') {
      return buildLocalVisionCandidates(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/identify-confirm') {
      const response = await confirmLocalVision(request, env);
      const data = await readJson(response);
      await record(ctx, env, response, data);
      return response;
    }

    // Compatibilidade: só entra aqui se o caminho local não puder ser usado.
    if (request.method === 'POST' && url.pathname === '/api/identify') {
      const { response, data } = await identifyFallback(request, env);

      await record(ctx, env, response, data);

      if (!response.ok || !data) return response;

      if (data.product) prepareProductImage(data.product);
      if (Array.isArray(data.products)) data.products = data.products.map(prepareProductImage);

      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: responseWithHeaders(response)
      });
    }

    return app.fetch(request, env, ctx);
  }
};
