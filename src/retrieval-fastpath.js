import { Buffer } from 'node:buffer';
import { parseSku } from './sku.js';
import { normalizePlatform } from './platform-scope.js';
import {
  preferSupabaseRead,
  supabaseProductsForCover
} from './supabase-read-store.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const DEFAULT_MIN_SCORE = 0.925;
const DEFAULT_MIN_MARGIN = 0.008;
const ALLOWED_REFERENCE_KINDS = new Set(['product', 'real_scan']);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ''));
}

function base64urlDecode(value) {
  return new Uint8Array(Buffer.from(String(value || ''), 'base64url'));
}

async function ticketKey(secret) {
  const material = await crypto.subtle.digest(
    'SHA-256',
    textBytes(`nisti-local-vision:${secret}`)
  );
  return crypto.subtle.importKey(
    'raw',
    material,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

function cookieValue(request, name) {
  const source = request.headers.get('cookie') || '';
  for (const part of source.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

async function readSignedTicket(env, token) {
  try {
    const [encoded, signature] = String(token || '').split('.', 2);
    const secret = String(
      env.TICKET_SECRET || env.ADMIN_PASSWORD || env.GEMINI_API_KEY || ''
    );
    if (!encoded || !signature || !secret) return null;

    const key = await ticketKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlDecode(signature),
      textBytes(encoded)
    );
    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(encoded))
    );
    if (Number(payload?.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function threshold(env, name, fallback) {
  const value = Number(env?.[name]);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) return fallback;
  return value;
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function evaluateRetrievalFastPath(ticket, env = {}) {
  const performance = ticket?.performance && typeof ticket.performance === 'object'
    ? ticket.performance
    : {};
  const codes = Array.isArray(ticket?.codes)
    ? ticket.codes.map(normalizeCode).filter(Boolean)
    : [];
  const topCode = codes[0] || '';
  const reportedTopCode = normalizeCode(performance.retrieval_top1_code);
  const reportedTop2Code = normalizeCode(performance.retrieval_top2_code);
  const topScore = Number(performance.retrieval_top1);
  const top2Score = Number(performance.retrieval_top2);
  const margin = Number(performance.retrieval_margin);
  const coverCount = Number(performance.cover_candidate_count || 0);
  const minScore = threshold(env, 'RETRIEVAL_FASTPATH_MIN_SCORE', DEFAULT_MIN_SCORE);
  const minMargin = threshold(env, 'RETRIEVAL_FASTPATH_MIN_MARGIN', DEFAULT_MIN_MARGIN);
  const references = Array.isArray(ticket?.references) ? ticket.references : [];
  const topReference = references
    .filter(item => normalizeCode(item?.capa_code) === topCode)
    .sort((a, b) => Number(a?.vector_rank || 999999) - Number(b?.vector_rank || 999999))[0];
  const referenceKind = String(topReference?.reference_kind || 'product').trim().toLowerCase();

  const base = {
    eligible: false,
    capa_code: topCode || null,
    top_score: Number.isFinite(topScore) ? topScore : null,
    top2_score: Number.isFinite(top2Score) ? top2Score : null,
    margin: Number.isFinite(margin) ? margin : null,
    min_score: minScore,
    min_margin: minMargin,
    cover_count: Number.isFinite(coverCount) ? coverCount : 0,
    reference_kind: referenceKind || null
  };

  if (!topCode || !reportedTopCode || topCode !== reportedTopCode) {
    return { ...base, reason: 'top1_code_mismatch' };
  }
  if (!Number.isFinite(topScore) || !Number.isFinite(top2Score) || !Number.isFinite(margin)) {
    return { ...base, reason: 'retrieval_metrics_missing' };
  }
  if (coverCount < 2 || !reportedTop2Code || reportedTop2Code === topCode) {
    return { ...base, reason: 'retrieval_competitor_missing' };
  }
  if (!ALLOWED_REFERENCE_KINDS.has(referenceKind)) {
    return { ...base, reason: 'untrusted_reference_kind' };
  }
  if (topScore < minScore) {
    return { ...base, reason: 'top1_score_below_fastpath' };
  }
  if (margin < minMargin || topScore <= top2Score) {
    return { ...base, reason: 'top1_margin_below_fastpath' };
  }

  return {
    ...base,
    eligible: true,
    reason: 'retrieval_score_margin_accept'
  };
}

function productPayload(product) {
  const parsed = parseSku(product.sku);
  const version = String(product.image_key || '').split('/').pop();
  const productImage = product.image_key
    ? `/api/images/${product.id}${version ? `?v=${encodeURIComponent(version)}` : ''}`
    : null;

  return {
    ...product,
    wireo: parsed.wireo,
    tassel: parsed.tassel,
    elastico: parsed.elastico,
    product_image_url: productImage,
    image_url: productImage
  };
}

async function productsForCoverFromD1(env, capaCode, platform) {
  const { results } = await env.DB.prepare(`
    SELECT p.*, pp.platform, pp.link
    FROM products p
    JOIN product_platforms pp ON pp.product_id=p.id
    WHERE UPPER(TRIM(p.capa_code))=? AND UPPER(TRIM(pp.platform))=?
    ORDER BY p.id ASC, pp.id ASC
  `).bind(
    normalizeCode(capaCode),
    normalizePlatform(platform)
  ).all();
  return results || [];
}

async function productsForCover(env, capaCode, platform) {
  const results = await preferSupabaseRead(
    env,
    () => supabaseProductsForCover(env, capaCode, normalizePlatform(platform)),
    () => productsForCoverFromD1(env, capaCode, platform),
    'fastpath-products-for-cover'
  );

  const seen = new Set();
  return (results || []).filter(product => {
    const id = Number(product.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function tryRetrievalFastPath(request, env) {
  const started = Date.now();
  const form = await request.formData().catch(() => null);
  if (!form) return null;

  const image = form.get('image');
  if (!(image instanceof File)) return null;

  const requestedPlatform = normalizePlatform(form.get('platform'));
  if (!requestedPlatform) return null;

  const formTicket = String(form.get('ticket') || '').trim();
  const cookieTicket = cookieValue(request, COOKIE_NAME);
  const headerTicket = request.headers.get('x-recognition-ticket');
  const ticket = await readSignedTicket(
    env,
    formTicket || cookieTicket || headerTicket
  );
  if (!ticket) return null;

  const platform = normalizePlatform(ticket.platform);
  if (!platform || platform !== requestedPlatform) return null;

  const decision = evaluateRetrievalFastPath(ticket, env);
  if (!decision.eligible || !decision.capa_code) return null;

  const products = await productsForCover(env, decision.capa_code, platform);
  const sourcePerformance = ticket.performance && typeof ticket.performance === 'object'
    ? ticket.performance
    : {};
  const candidateGenerationMs = Math.max(0, Number(sourcePerformance.total_ms || 0));
  const fastPathMs = Date.now() - started;
  const performance = {
    ...sourcePerformance,
    pipeline_version: 'platform-vectorize-retrieval-fastpath-v8.11',
    verification_mode: 'retrieval-score-margin-fastpath',
    retrieval_source: 'vectorize-platform-ticket-reuse',
    reused_candidates: true,
    candidate_generation_ms: candidateGenerationMs,
    candidate_count: 1,
    accepted_by: 'retrieval-score-margin-fastpath',
    verifier_reason_code: decision.reason,
    verifier_evidence: `top1=${decision.capa_code}; score=${decision.top_score?.toFixed(6)}; margin=${decision.margin?.toFixed(6)}; min_score=${decision.min_score}; min_margin=${decision.min_margin}`,
    gemini_calls: 0,
    fastpath_ms: fastPathMs,
    total_ms: candidateGenerationMs + fastPathMs,
    model: sourcePerformance.model || env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2'
  };

  if (!products.length) {
    return json({
      error: 'A capa foi reconhecida pelo retrieval, mas não existe produto correspondente nesta plataforma.',
      technical_error: 'product_missing_for_platform',
      capa_code: decision.capa_code,
      platform,
      performance
    }, 422);
  }

  const confidence = decision.top_score;
  if (products.length > 1) {
    return json({
      needs_selection: true,
      selection_reason: 'same_cover_multiple_skus',
      capa_code: decision.capa_code,
      platform,
      products: products.map(productPayload),
      confidence,
      identified_by: 'platform-vectorize-v8.11-retrieval-fastpath+human-sku-selection',
      performance
    });
  }

  return json({
    product: productPayload(products[0]),
    capa_code: decision.capa_code,
    platform,
    confidence,
    identified_by: 'platform-vectorize-v8.11-retrieval-fastpath',
    performance
  });
}
