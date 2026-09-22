import { Buffer } from 'node:buffer';
import app from './vectorize-performance-router.js';
import { normalizePlatform } from './platform-scope.js';
import { parseSku } from './sku.js';
import { recordScanOccurrence, trainOccurrenceDirectly } from './occurrences-router.js';

const REVIEW_VERSION = 'v8.24.2';
const SHADOW_PURPOSE = 'geometric-shadow-evidence-v818';
const MAX_REVIEW_CANDIDATES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const AMBIGUOUS_MARGIN_LIMIT = 0.005;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ''));
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

async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array ? value : textBytes(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifySignedTicket(env, token) {
  const secret = String(env.TICKET_SECRET || env.ADMIN_PASSWORD || env.GEMINI_API_KEY || '');
  if (!secret) return null;

  const [encoded, signature] = String(token || '').split('.', 2);
  if (!encoded || !signature) return null;

  try {
    const key = await ticketKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      new Uint8Array(Buffer.from(signature, 'base64url')),
      textBytes(encoded)
    );
    if (!valid) return null;

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (Number(payload?.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function normalizeSignedCandidates(candidates, limit = MAX_REVIEW_CANDIDATES) {
  const normalized = [];
  const seenCodes = new Set();

  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const capaCode = normalizeCode(raw?.capa_code);
    const referenceId = Number(raw?.reference_id || 0);
    const retrievalScore = Number(raw?.retrieval_score);
    const vectorRank = Number(raw?.vector_rank || normalized.length + 1);
    const referenceKind = String(raw?.reference_kind || 'product').trim().toLowerCase() || 'product';

    if (
      !capaCode ||
      seenCodes.has(capaCode) ||
      !Number.isInteger(referenceId) ||
      referenceId <= 0 ||
      !Number.isFinite(retrievalScore) ||
      !Number.isFinite(vectorRank) ||
      vectorRank <= 0
    ) continue;

    seenCodes.add(capaCode);
    normalized.push({
      capa_code: capaCode,
      reference_id: referenceId,
      retrieval_score: retrievalScore,
      vector_rank: vectorRank,
      reference_kind: referenceKind
    });
  }

  normalized.sort((a, b) => a.vector_rank - b.vector_rank);
  return normalized.slice(0, Math.max(1, Number(limit) || MAX_REVIEW_CANDIDATES));
}

export function validateReviewTicketPayloads({ productionPayload, shadowPayload, platform } = {}) {
  const requestedPlatform = normalizePlatform(platform);
  const productionPlatform = normalizePlatform(productionPayload?.platform);
  const shadowPlatform = normalizePlatform(shadowPayload?.platform);

  if (!requestedPlatform || !productionPlatform || !shadowPlatform) {
    return { ok: false, status: 400, error: 'Plataforma obrigatória para revisão.' };
  }
  if (requestedPlatform !== productionPlatform || requestedPlatform !== shadowPlatform) {
    return { ok: false, status: 409, error: 'Plataforma divergente entre os tickets de revisão.' };
  }
  if (shadowPayload?.purpose !== SHADOW_PURPOSE || !shadowPayload?.nonce) {
    return { ok: false, status: 401, error: 'Ticket shadow inválido para revisão.' };
  }

  const productionCodes = Array.isArray(productionPayload?.codes)
    ? productionPayload.codes.map(normalizeCode).filter(Boolean)
    : [];
  const topCode = productionCodes[0] || '';
  const performance = productionPayload?.performance && typeof productionPayload.performance === 'object'
    ? productionPayload.performance
    : {};
  const margin = Number(performance.retrieval_margin);
  const coverCount = Number(performance.cover_candidate_count || 0);
  const productionTopScore = Number(
    performance.retrieval_top1 ?? productionPayload?.scores?.[topCode]
  );

  if (productionCodes.length !== 1 || !topCode) {
    return { ok: false, status: 409, error: 'Ticket de produção não está restrito ao Top-1.' };
  }
  if (!Number.isFinite(margin) || coverCount <= 1 || margin >= AMBIGUOUS_MARGIN_LIMIT) {
    return { ok: false, status: 409, error: 'A consulta não corresponde a uma ambiguidade Top-1 revisável.' };
  }

  const candidates = normalizeSignedCandidates(shadowPayload?.candidates);
  if (candidates.length < 2) {
    return { ok: false, status: 409, error: 'Não há candidatas suficientes para revisão humana.' };
  }
  if (candidates[0].capa_code !== topCode) {
    return { ok: false, status: 409, error: 'Top-1 do ticket shadow diverge da produção.' };
  }
  if (
    Number.isFinite(productionTopScore) &&
    Math.abs(productionTopScore - candidates[0].retrieval_score) > 0.0001
  ) {
    return { ok: false, status: 409, error: 'Score Top-1 divergente entre os tickets de revisão.' };
  }

  return {
    ok: true,
    platform: requestedPlatform,
    top_code: topCode,
    margin,
    candidates
  };
}

function operatorNameFromRequest(request, body = null) {
  const raw = request.headers.get('x-operator-name') || body?.operator_name || '';
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return String(raw).trim();
  }
}

function operatorIdFromRequest(request, body = null) {
  return String(
    request.headers.get('x-user-id') ||
    request.headers.get('x-operator-id') ||
    body?.operator_id ||
    ''
  ).trim() || null;
}

function referenceImageUrl(referenceId, imageKey) {
  const id = Number(referenceId || 0);
  if (!id || !imageKey) return null;
  const version = String(imageKey).split('/').pop() || 'current';
  return `/api/reference-images/${id}?v=${encodeURIComponent(version)}`;
}

async function persistOccurrenceCandidates(env, occurrenceId, candidates) {
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    await env.DB.prepare(`
      INSERT OR REPLACE INTO scan_occurrence_candidates (
        occurrence_id,capa_code,candidate_rank,retrieval_score,reference_id,reference_kind
      ) VALUES (?,?,?,?,?,?)
    `).bind(
      occurrenceId,
      candidate.capa_code,
      index + 1,
      candidate.retrieval_score,
      candidate.reference_id,
      candidate.reference_kind
    ).run();
  }
}

async function persistReviewToken(env, occurrenceId, reviewToken) {
  const hash = await sha256Hex(reviewToken);
  await env.DB.prepare(`
    INSERT INTO scan_occurrence_review_sessions (occurrence_id,review_token_hash)
    VALUES (?,?)
  `).bind(occurrenceId, hash).run();
}

async function reviewCandidatesForOccurrence(env, occurrenceId) {
  const { results } = await env.DB.prepare(`
    SELECT
      c.occurrence_id,c.capa_code,c.candidate_rank,c.retrieval_score,
      c.reference_id,c.reference_kind,r.image_key,r.active,r.capa_code AS reference_capa_code
    FROM scan_occurrence_candidates c
    LEFT JOIN cover_visual_references r ON r.id=c.reference_id
    WHERE c.occurrence_id=?
    ORDER BY c.candidate_rank ASC
  `).bind(occurrenceId).all();

  return (results || []).map(row => {
    const referenceCode = normalizeCode(row.reference_capa_code);
    const candidateCode = normalizeCode(row.capa_code);
    const authoritativeImage = Number(row.active || 0) === 1 && referenceCode === candidateCode
      ? referenceImageUrl(row.reference_id, row.image_key)
      : null;

    return {
      capa_code: candidateCode,
      candidate_rank: Number(row.candidate_rank || 0),
      retrieval_score: Number(row.retrieval_score || 0),
      reference_id: Number(row.reference_id || 0) || null,
      reference_kind: String(row.reference_kind || 'product'),
      image_url: authoritativeImage
    };
  }).filter(row => row.capa_code);
}

function productPayload(product) {
  const parsed = parseSku(product.sku);
  const version = String(product.image_key || '').split('/').pop();
  const imageUrl = product.image_key
    ? `/api/images/${product.id}${version ? `?v=${encodeURIComponent(version)}` : ''}`
    : null;

  return {
    ...product,
    wireo: parsed.wireo,
    tassel: parsed.tassel,
    elastico: parsed.elastico,
    product_image_url: imageUrl,
    image_url: imageUrl
  };
}

async function productsForCover(env, capaCode, platform) {
  const { results } = await env.DB.prepare(`
    SELECT p.*, pp.platform, pp.link
    FROM products p
    JOIN product_platforms pp ON pp.product_id=p.id
    WHERE UPPER(TRIM(p.capa_code))=? AND UPPER(TRIM(pp.platform))=?
    ORDER BY p.id ASC, pp.id ASC
  `).bind(normalizeCode(capaCode), normalizePlatform(platform)).all();

  const seen = new Set();
  return (results || []).filter(product => {
    const id = Number(product.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function validateStoredCandidateSelection({ occurrence, candidate, capaCode } = {}) {
  const requestedCode = normalizeCode(capaCode);
  if (!requestedCode) return { ok: false, status: 400, error: 'capa_code é obrigatório.' };
  if (!occurrence) return { ok: false, status: 404, error: 'Ocorrência não encontrada.' };
  if (String(occurrence.status || '') !== 'pending') {
    return { ok: false, status: 409, error: 'A ocorrência já foi encerrada.' };
  }
  if (!normalizePlatform(occurrence.platform)) {
    return { ok: false, status: 409, error: 'Ocorrência sem plataforma válida.' };
  }
  if (!candidate || normalizeCode(candidate.capa_code) !== requestedCode) {
    return { ok: false, status: 409, error: 'A capa selecionada não pertence às candidatas persistidas desta ocorrência.' };
  }
  return { ok: true, capa_code: requestedCode, platform: normalizePlatform(occurrence.platform) };
}

async function validateReviewToken(env, occurrenceId, reviewToken) {
  if (!reviewToken) return false;
  const row = await env.DB.prepare(`
    SELECT review_token_hash
    FROM scan_occurrence_review_sessions
    WHERE occurrence_id=?
    LIMIT 1
  `).bind(occurrenceId).first();
  if (!row?.review_token_hash) return false;
  const suppliedHash = await sha256Hex(reviewToken);
  return suppliedHash === String(row.review_token_hash);
}

async function handleStartReview(request, env) {
  if (!env?.DB || !env?.PRODUCT_IMAGES) {
    return json({ error: 'D1/R2 não configurados para revisão supervisionada.' }, 503);
  }

  const form = await request.formData().catch(() => null);
  const image = form?.get('image');
  const platform = normalizePlatform(form?.get('platform'));
  const productionTicket = String(form?.get('production_ticket') || '').trim();
  const shadowTicket = String(form?.get('shadow_ticket') || '').trim();

  if (!(image instanceof File)) return json({ error: 'Foto da capa obrigatória.' }, 400);
  if (Number(image.size || 0) > MAX_IMAGE_BYTES) return json({ error: 'Foto excede 10 MB.' }, 413);

  const [productionPayload, shadowPayload] = await Promise.all([
    verifySignedTicket(env, productionTicket),
    verifySignedTicket(env, shadowTicket)
  ]);
  if (!productionPayload || !shadowPayload) {
    return json({ error: 'Tickets de revisão inválidos ou expirados.' }, 401);
  }

  const validation = validateReviewTicketPayloads({
    productionPayload,
    shadowPayload,
    platform
  });
  if (!validation.ok) return json({ error: validation.error }, validation.status);

  const photoBytes = new Uint8Array(await image.arrayBuffer());
  const operatorName = operatorNameFromRequest(request);
  const operatorId = operatorIdFromRequest(request);
  const occurrenceId = await recordScanOccurrence(env, {
    photoBytes,
    photoMime: image.type || 'image/jpeg',
    platform: validation.platform,
    suggestedCapaCode: validation.top_code,
    confidence: validation.candidates[0]?.retrieval_score || 0,
    errorReason: 'ambiguous_top1_margin',
    operatorName,
    operatorId
  });

  if (!occurrenceId) {
    return json({ error: 'Falha ao registrar a ocorrência para revisão.' }, 503);
  }

  const reviewToken = crypto.randomUUID();
  try {
    await persistOccurrenceCandidates(env, occurrenceId, validation.candidates);
    await persistReviewToken(env, occurrenceId, reviewToken);
  } catch (error) {
    console.error('Falha ao persistir candidatas da revisão ambígua:', error);
    return json({
      error: 'Ocorrência registrada, mas as candidatas não puderam ser preparadas para seleção.',
      occurrence_id: occurrenceId,
      sent_to_adm: true
    }, 503);
  }

  const candidates = await reviewCandidatesForOccurrence(env, occurrenceId);
  if (candidates.length < 2) {
    return json({
      error: 'Ocorrência registrada, mas as imagens candidatas não estão disponíveis para seleção segura.',
      occurrence_id: occurrenceId,
      sent_to_adm: true
    }, 503);
  }

  return json({
    ok: true,
    review_version: REVIEW_VERSION,
    occurrence_id: occurrenceId,
    review_token: reviewToken,
    platform: validation.platform,
    candidates,
    sent_to_adm: true,
    production_changed: false
  });
}

async function handleConfirmReview(request, env) {
  if (!env?.DB) return json({ error: 'D1 não configurado.' }, 503);
  const body = await request.json().catch(() => null);
  const occurrenceId = Number(body?.occurrence_id || 0);
  const capaCode = normalizeCode(body?.capa_code);
  const reviewToken = String(body?.review_token || '').trim();

  if (!occurrenceId || !capaCode || !reviewToken) {
    return json({ error: 'occurrence_id, capa_code e review_token são obrigatórios.' }, 400);
  }

  if (!(await validateReviewToken(env, occurrenceId, reviewToken))) {
    return json({ error: 'Token de revisão inválido.' }, 401);
  }

  const occurrence = await env.DB.prepare(`
    SELECT id,image_key,platform,status
    FROM scan_occurrences
    WHERE id=?
    LIMIT 1
  `).bind(occurrenceId).first();
  const candidate = await env.DB.prepare(`
    SELECT occurrence_id,capa_code,candidate_rank,retrieval_score,reference_id,reference_kind
    FROM scan_occurrence_candidates
    WHERE occurrence_id=? AND UPPER(TRIM(capa_code))=?
    LIMIT 1
  `).bind(occurrenceId, capaCode).first();

  const validation = validateStoredCandidateSelection({ occurrence, candidate, capaCode });
  if (!validation.ok) return json({ error: validation.error }, validation.status);

  const products = await productsForCover(env, validation.capa_code, validation.platform);
  if (!products.length) {
    return json({
      error: 'A capa selecionada não possui SKU ativo nesta plataforma. O treinamento foi bloqueado.'
    }, 409);
  }

  const operatorName = operatorNameFromRequest(request, body);
  await trainOccurrenceDirectly(env, occurrenceId, validation.capa_code, operatorName || null);

  const productPayloads = products.map(productPayload);
  return json({
    ok: true,
    confirmed: true,
    trained: true,
    review_version: REVIEW_VERSION,
    occurrence_id: occurrenceId,
    capa_code: validation.capa_code,
    platform: validation.platform,
    product: productPayloads.length === 1 ? productPayloads[0] : null,
    products: productPayloads,
    needs_product_selection: productPayloads.length > 1,
    production_changed: false
  });
}

export async function handleAmbiguousReviewRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/api/operator/ambiguous-review/start') {
    return handleStartReview(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/api/operator/ambiguous-review/confirm') {
    return handleConfirmReview(request, env);
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const response = await handleAmbiguousReviewRequest(request, env);
    if (response) return response;
    return app.fetch(request, env, ctx);
  }
};
