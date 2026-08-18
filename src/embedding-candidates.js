import { parseSku } from './sku.js';

const EMBEDDING_DIMENSIONS = 768;
const CANDIDATE_LIMIT = 8;
const INDEX_CACHE_TTL_MS = 30_000;
const TICKET_TTL_SECONDS = 120;
const MAX_EMBEDDING_MS = 3200;

let visualIndexCache = { expiresAt: 0, rows: null };

class CandidateError extends Error {
  constructor(message, status = 400, code = 'candidate_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64url(bytes) {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ''));
}

async function ticketKey(secret) {
  const material = await crypto.subtle.digest('SHA-256', textBytes(`nisti-local-vision:${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signTicket(env, payload) {
  const secret = String(env.GEMINI_API_KEY || '');
  if (!secret) throw new CandidateError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');
  const encoded = base64url(textBytes(JSON.stringify(payload)));
  const key = await ticketKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, textBytes(encoded)));
  return `${encoded}.${base64url(signature)}`;
}

async function readTicket(env, token) {
  const [encoded, signature] = String(token || '').split('.', 2);
  if (!encoded || !signature) throw new CandidateError('Ticket de reconhecimento inválido.', 400, 'invalid_ticket');
  const secret = String(env.GEMINI_API_KEY || '');
  if (!secret) throw new CandidateError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');
  const key = await ticketKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, decodeBase64url(signature), textBytes(encoded));
  if (!valid) throw new CandidateError('Ticket de reconhecimento inválido.', 400, 'invalid_ticket');
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64url(encoded)));
  } catch {
    throw new CandidateError('Ticket de reconhecimento inválido.', 400, 'invalid_ticket');
  }
  if (Number(payload?.exp || 0) <= Math.floor(Date.now() / 1000)) {
    throw new CandidateError('Ticket de reconhecimento expirado. Fotografe a capa novamente.', 400, 'expired_ticket');
  }
  return payload;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i]);
    const bv = Number(b[i]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return -1;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (!magA || !magB) return -1;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function embedImage(env, bytes, mimeType) {
  if (!env.GEMINI_API_KEY) throw new CandidateError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');
  const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('embedding-timeout'), MAX_EMBEDDING_MS);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      signal: controller.signal,
      body: JSON.stringify({
        content: {
          parts: [{
            inline_data: {
              mime_type: mimeType || 'image/jpeg',
              data: base64(bytes)
            }
          }]
        },
        output_dimensionality: EMBEDDING_DIMENSIONS
      })
    });
    if (!response.ok) {
      const status = [429, 500, 502, 503, 504].includes(response.status) ? 503 : 502;
      throw new CandidateError(`Gemini Embedding falhou (${response.status})`, status, 'embedding_failed');
    }
    const payload = await response.json();
    const values = payload?.embedding?.values || payload?.embeddings?.[0]?.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
      throw new CandidateError('Gemini Embedding não retornou vetor válido', 502, 'embedding_empty');
    }
    return { model, values };
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new CandidateError('O embedding da imagem excedeu o tempo máximo.', 503, 'embedding_timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loadVisualIndex(env, timings) {
  const now = Date.now();
  if (visualIndexCache.rows && visualIndexCache.expiresAt > now) {
    timings.index_cache_hit = true;
    return visualIndexCache.rows;
  }

  const started = Date.now();
  const data = await env.DB.prepare(`
    SELECT capa_code,image_key,embedding_json
    FROM cover_embeddings
  `).all();

  const rows = [];
  for (const row of data?.results || []) {
    try {
      const vector = JSON.parse(row.embedding_json);
      if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) continue;
      rows.push({
        capa_code: String(row.capa_code || '').trim().toUpperCase(),
        image_key: row.image_key,
        vector
      });
    } catch {}
  }

  if (!rows.length) throw new CandidateError('Índice visual vazio.', 503, 'visual_index_empty');
  visualIndexCache = { rows, expiresAt: now + INDEX_CACHE_TTL_MS };
  timings.index_cache_hit = false;
  timings.index_load_ms = Date.now() - started;
  return rows;
}

async function candidateImageUrl(env, candidate) {
  let product = await env.DB.prepare(`
    SELECT id,image_key
    FROM products
    WHERE capa_code=? AND image_key=?
    ORDER BY id DESC
    LIMIT 1
  `).bind(candidate.capa_code, candidate.image_key).first();

  if (!product) {
    product = await env.DB.prepare(`
      SELECT id,image_key
      FROM products
      WHERE capa_code=? AND image_key IS NOT NULL
      ORDER BY id DESC
      LIMIT 1
    `).bind(candidate.capa_code).first();
  }

  if (!product?.id || !product?.image_key) return null;
  const version = String(product.image_key).split('/').pop() || 'current';
  return `/api/images/${product.id}?v=${encodeURIComponent(version)}`;
}

export async function buildLocalVisionCandidates(request, env) {
  const started = Date.now();
  const timings = { pipeline_version: 'embedding-candidates-v1' };

  try {
    const form = await request.formData();
    const image = form.get('image');
    if (!(image instanceof File)) return json({ error: 'Foto da capa obrigatória' }, 400);
    const readStarted = Date.now();
    const bytes = new Uint8Array(await image.arrayBuffer());
    timings.read_photo_ms = Date.now() - readStarted;
    timings.upload_bytes = image.size;

    const parallelStarted = Date.now();
    const [embedding, rows] = await Promise.all([
      embedImage(env, bytes, image.type || 'image/jpeg'),
      loadVisualIndex(env, timings)
    ]);
    timings.embedding_and_index_ms = Date.now() - parallelStarted;
    timings.model = embedding.model;

    const scoreStarted = Date.now();
    const scored = [];
    for (const row of rows) {
      const score = cosineSimilarity(embedding.values, row.vector);
      if (!Number.isFinite(score)) continue;
      scored.push({ capa_code: row.capa_code, image_key: row.image_key, retrieval_score: score });
    }
    scored.sort((a, b) => b.retrieval_score - a.retrieval_score);

    const seen = new Set();
    const selected = [];
    for (const candidate of scored) {
      if (!candidate.capa_code || seen.has(candidate.capa_code)) continue;
      seen.add(candidate.capa_code);
      selected.push({ ...candidate, retrieval_rank: selected.length + 1 });
      if (selected.length >= CANDIDATE_LIMIT) break;
    }
    timings.score_ms = Date.now() - scoreStarted;
    timings.index_size = rows.length;
    timings.candidate_count = selected.length;
    timings.retrieval_top1 = selected[0]?.retrieval_score ?? null;
    timings.retrieval_top1_code = selected[0]?.capa_code || null;
    timings.retrieval_top2 = selected[1]?.retrieval_score ?? null;
    timings.retrieval_top2_code = selected[1]?.capa_code || null;
    timings.retrieval_margin = Number.isFinite(timings.retrieval_top1) && Number.isFinite(timings.retrieval_top2)
      ? timings.retrieval_top1 - timings.retrieval_top2
      : 1;

    const candidates = [];
    for (const candidate of selected) {
      const imageUrl = await candidateImageUrl(env, candidate);
      if (!imageUrl) continue;
      candidates.push({
        capa_code: candidate.capa_code,
        retrieval_rank: candidate.retrieval_rank,
        retrieval_score: candidate.retrieval_score,
        image_url: imageUrl
      });
    }

    if (!candidates.length) {
      throw new CandidateError('Nenhuma referência visual disponível para comparação.', 503, 'candidate_images_missing');
    }

    timings.total_ms = Date.now() - started;
    const payload = {
      exp: Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS,
      nonce: crypto.randomUUID(),
      codes: candidates.map(candidate => candidate.capa_code),
      scores: Object.fromEntries(candidates.map(candidate => [candidate.capa_code, candidate.retrieval_score])),
      performance: timings
    };
    const ticket = await signTicket(env, payload);

    return json({
      ok: true,
      ticket,
      candidates,
      performance: timings
    });
  } catch (error) {
    timings.total_ms = Date.now() - started;
    return json({
      error: error?.message || 'Falha ao localizar candidatas',
      technical_error: error?.code || 'candidate_error',
      performance: timings
    }, Number(error?.status) || 500);
  }
}

function productPayload(product) {
  const parsed = parseSku(product.sku);
  const version = String(product.image_key || '').split('/').pop();
  return {
    ...product,
    wireo: parsed.wireo,
    tassel: parsed.tassel,
    elastico: parsed.elastico,
    image_url: product.image_key
      ? `/api/images/${product.id}${version ? `?v=${encodeURIComponent(version)}` : ''}`
      : null
  };
}

function normalizeLocalMetrics(value) {
  const source = value && typeof value === 'object' ? value : {};
  const number = key => {
    const parsed = Number(source[key]);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    candidates_tested: number('candidates_tested'),
    local_cv_ms: number('local_cv_ms'),
    good_matches: number('good_matches'),
    inliers: number('inliers'),
    inlier_ratio: number('inlier_ratio'),
    median_distance: number('median_distance'),
    geometric_score: number('geometric_score'),
    confidence: number('confidence'),
    runner: String(source.runner || 'opencv-orb-ransac').slice(0, 80)
  };
}

export async function confirmLocalVision(request, env) {
  const started = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    const ticket = await readTicket(env, body.ticket);
    const local = normalizeLocalMetrics(body.local_match);
    const capaCode = String(body.capa_code || '').trim().toUpperCase();
    const ticketPerformance = ticket.performance || {};
    const performance = {
      ...ticketPerformance,
      local_cv_ms: local.local_cv_ms,
      local_good_matches: local.good_matches,
      local_inliers: local.inliers,
      local_inlier_ratio: local.inlier_ratio,
      local_median_distance: local.median_distance,
      local_geometric_score: local.geometric_score,
      candidate_count: local.candidates_tested ?? ticketPerformance.candidate_count ?? null,
      verification_mode: 'opencv-orb-ransac',
      accepted_by: capaCode ? 'opencv-orb-ransac' : 'rejected-by-opencv-orb-ransac',
      model: env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2'
    };

    if (!capaCode) {
      performance.total_ms = Math.max(Number(ticketPerformance.total_ms || 0), Date.now() - started + Number(ticketPerformance.total_ms || 0));
      return json({
        error: 'Não encontrei uma correspondência geométrica segura para esta capa.',
        confidence: local.confidence,
        identified_by: 'embedding+opencv-orb-ransac',
        performance
      }, 422);
    }

    if (!Array.isArray(ticket.codes) || !ticket.codes.includes(capaCode)) {
      throw new CandidateError('A capa confirmada não pertence às candidatas desta foto.', 400, 'candidate_not_in_ticket');
    }

    const { results } = await env.DB.prepare(`
      SELECT p.*,
        (SELECT pp.platform FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform,
        (SELECT pp.link FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS link
      FROM products p
      WHERE p.capa_code=?
      ORDER BY p.id ASC
    `).bind(capaCode).all();

    performance.database_ms = Date.now() - started;
    performance.total_ms = Number(ticketPerformance.total_ms || 0) + Math.max(0, Number(local.local_cv_ms || 0)) + performance.database_ms;
    const retrievalScore = Number(ticket.scores?.[capaCode]);

    if (!results?.length) {
      return json({
        error: 'A capa foi confirmada, mas não existe produto correspondente no banco.',
        capa_code: capaCode,
        confidence: local.confidence,
        retrieval_score: Number.isFinite(retrievalScore) ? retrievalScore : null,
        identified_by: 'embedding+opencv-orb-ransac',
        performance
      }, 422);
    }

    if (results.length > 1) {
      return json({
        needs_selection: true,
        selection_reason: 'same_cover_multiple_skus',
        capa_code: capaCode,
        products: results.map(productPayload),
        confidence: local.confidence,
        retrieval_score: Number.isFinite(retrievalScore) ? retrievalScore : null,
        identified_by: 'embedding+opencv-orb-ransac+human-sku-selection',
        performance
      });
    }

    return json({
      product: productPayload(results[0]),
      capa_code: capaCode,
      confidence: local.confidence,
      retrieval_score: Number.isFinite(retrievalScore) ? retrievalScore : null,
      identified_by: 'embedding+opencv-orb-ransac',
      performance
    });
  } catch (error) {
    return json({
      error: error?.message || 'Falha ao confirmar reconhecimento local',
      technical_error: error?.code || 'local_confirmation_error',
      performance: { total_ms: Date.now() - started }
    }, Number(error?.status) || 500);
  }
}
