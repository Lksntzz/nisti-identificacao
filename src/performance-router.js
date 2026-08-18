import app from './edge-router.js';
import { fastIdentify } from './fast-identify-v4.js';
import { buildLocalVisionCandidates, confirmLocalVision } from './embedding-candidates.js';
import { recordRecognitionAttempt } from './recognition-metrics.js';

// O fluxo principal usa embedding + visão local. O fallback generativo fica
// disponível apenas para compatibilidade e não é mais interrompido em 5 s.
const FALLBACK_MAX_MS = 20_000;
const UNMATCHED_SUGGESTION_LIMIT = 3;

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

function decodeTicketPayload(token) {
  try {
    const [encoded] = String(token || '').split('.', 1);
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function unmatchedSuggestions(env, ticketToken) {
  const payload = decodeTicketPayload(ticketToken);
  const orderedIds = [];
  for (const value of payload?.product_ids || []) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || orderedIds.includes(id)) continue;
    orderedIds.push(id);
    if (orderedIds.length >= UNMATCHED_SUGGESTION_LIMIT) break;
  }
  if (!orderedIds.length) return [];

  const placeholders = orderedIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT p.id,p.sku,p.capa_code,p.nome,p.variacao,p.image_key,
      (SELECT pp.platform FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform
    FROM products p
    WHERE p.id IN (${placeholders}) AND p.image_key IS NOT NULL
  `).bind(...orderedIds).all();

  const byId = new Map((results || []).map(product => [Number(product.id), product]));
  const scores = payload?.scores || {};
  const suggestions = [];
  const seenCovers = new Set();
  for (const id of orderedIds) {
    const product = byId.get(id);
    if (!product) continue;
    const capaCode = String(product.capa_code || '').trim().toUpperCase();
    if (!capaCode || seenCovers.has(capaCode)) continue;
    seenCovers.add(capaCode);
    suggestions.push({
      product_id: Number(product.id),
      sku: product.sku,
      capa_code: capaCode,
      nome: product.nome,
      variacao: product.variacao,
      platform: product.platform,
      image_url: resultImageUrl(product),
      retrieval_score: Number.isFinite(Number(scores[capaCode])) ? Number(scores[capaCode]) : null,
      confirmed: false
    });
  }
  return suggestions.slice(0, UNMATCHED_SUGGESTION_LIMIT);
}

function shouldOfferSuggestions(response, data) {
  if (response.status !== 422 || !data) return false;
  const text = `${data.error || ''} ${data.identified_by || ''}`.toLowerCase();
  return text.includes('correspondência geométrica') || text.includes('registered-mockups');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/identify-candidates') {
      return buildLocalVisionCandidates(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/identify-confirm') {
      const requestCopy = request.clone();
      const response = await confirmLocalVision(request, env);
      const data = await readJson(response);
      await record(ctx, env, response, data);

      if (!shouldOfferSuggestions(response, data)) return response;
      const body = await requestCopy.json().catch(() => ({}));
      const suggestions = await unmatchedSuggestions(env, body.ticket).catch(() => []);
      if (!suggestions.length) return response;

      return new Response(JSON.stringify({
        ...data,
        suggestions,
        suggestions_are_unconfirmed: true
      }), {
        status: response.status,
        statusText: response.statusText,
        headers: responseWithHeaders(response)
      });
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
