import { buildLocalVisionCandidates as buildLegacyCandidates } from './embedding-candidates.js';

const EMBEDDING_DIMENSIONS = 768;
const VECTOR_TOP_K = 8;
const COVER_LIMIT = 6;
const MOCKUPS_PER_COVER = 2;
const MAX_MOCKUPS = COVER_LIMIT * MOCKUPS_PER_COVER;
const TICKET_TTL_SECONDS = 120;
const MAX_EMBEDDING_MS = 5000;

class RetrievalError extends Error {
  constructor(message, status = 400, code = 'vector_retrieval_error') {
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

function textBytes(value) {
  return new TextEncoder().encode(String(value || ''));
}

async function ticketKey(secret) {
  const material = await crypto.subtle.digest('SHA-256', textBytes(`nisti-local-vision:${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function signTicket(env, payload) {
  const secret = String(env.GEMINI_API_KEY || '');
  if (!secret) throw new RetrievalError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');
  const encoded = base64url(textBytes(JSON.stringify(payload)));
  const key = await ticketKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, textBytes(encoded)));
  return `${encoded}.${base64url(signature)}`;
}

async function embedImage(env, bytes, mimeType) {
  if (!env.GEMINI_API_KEY) throw new RetrievalError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');
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
      throw new RetrievalError(`Gemini Embedding falhou (${response.status})`, status, 'embedding_failed');
    }

    const payload = await response.json();
    const values = payload?.embedding?.values || payload?.embeddings?.[0]?.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
      throw new RetrievalError('Gemini Embedding não retornou vetor válido', 502, 'embedding_empty');
    }
    return { model, values };
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new RetrievalError('O embedding da imagem excedeu o tempo máximo.', 503, 'embedding_timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function codeFromMatch(match) {
  const metadataCode = String(match?.metadata?.capa_code || '').trim().toUpperCase();
  if (metadataCode) return metadataCode;
  const id = String(match?.id || '');
  return id.startsWith('cover:') ? id.slice(6).trim().toUpperCase() : '';
}

async function queryVectorize(env, vector, timings) {
  if (!env.COVER_VECTORS?.query) throw new RetrievalError('Vectorize não configurado', 503, 'vectorize_not_configured');
  const started = Date.now();
  const result = await env.COVER_VECTORS.query(vector, {
    topK: VECTOR_TOP_K,
    returnValues: false,
    returnMetadata: 'all'
  });
  timings.vectorize_ms = Date.now() - started;
  timings.vectorize_count = Number(result?.count || result?.matches?.length || 0);

  const seen = new Set();
  const covers = [];
  for (const match of result?.matches || []) {
    const capaCode = codeFromMatch(match);
    if (!capaCode || seen.has(capaCode)) continue;
    seen.add(capaCode);
    covers.push({
      capa_code: capaCode,
      retrieval_rank: covers.length + 1,
      retrieval_score: Number(match?.score || 0),
      vector_id: String(match?.id || ''),
      vector_image_key: match?.metadata?.image_key || null
    });
    if (covers.length >= COVER_LIMIT) break;
  }
  return covers;
}

async function attachRegisteredMockups(env, covers, timings) {
  if (!covers.length) return [];
  const started = Date.now();
  const codes = covers.map(item => item.capa_code);
  const placeholders = codes.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT id,sku,capa_code,image_key,updated_at
    FROM products
    WHERE capa_code IN (${placeholders}) AND image_key IS NOT NULL
    ORDER BY id DESC
  `).bind(...codes).all();

  const byCode = new Map(codes.map(code => [code, []]));
  for (const product of results || []) {
    const code = String(product.capa_code || '').trim().toUpperCase();
    if (byCode.has(code)) byCode.get(code).push(product);
  }

  const candidates = [];
  for (const cover of covers) {
    const products = byCode.get(cover.capa_code) || [];
    products.sort((a, b) => {
      const aExact = a.image_key === cover.vector_image_key ? 1 : 0;
      const bExact = b.image_key === cover.vector_image_key ? 1 : 0;
      return bExact - aExact || Number(b.id) - Number(a.id);
    });
    for (const product of products.slice(0, MOCKUPS_PER_COVER)) {
      const version = String(product.image_key || '').split('/').pop() || 'current';
      candidates.push({
        product_id: Number(product.id),
        sku: product.sku,
        capa_code: cover.capa_code,
        retrieval_rank: cover.retrieval_rank,
        retrieval_score: cover.retrieval_score,
        image_key: product.image_key,
        image_url: `/api/images/${product.id}?v=${encodeURIComponent(version)}`
      });
      if (candidates.length >= MAX_MOCKUPS) break;
    }
    if (candidates.length >= MAX_MOCKUPS) break;
  }

  timings.candidate_lookup_ms = Date.now() - started;
  timings.mockup_candidate_count = candidates.length;
  return candidates;
}

export async function buildVectorizeCandidates(request, env) {
  // Rollout seguro: enquanto o binding ainda não existir, o sistema atual continua operando.
  if (!env.COVER_VECTORS?.query) return buildLegacyCandidates(request, env);

  const started = Date.now();
  const timings = { pipeline_version: 'gemini-embedding+vectorize-v1', retrieval_source: 'vectorize' };

  try {
    const form = await request.formData();
    const image = form.get('image');
    if (!(image instanceof File)) return json({ error: 'Foto da capa obrigatória' }, 400);

    const readStarted = Date.now();
    const bytes = new Uint8Array(await image.arrayBuffer());
    timings.read_photo_ms = Date.now() - readStarted;
    timings.upload_bytes = image.size;

    const embeddingStarted = Date.now();
    const embedding = await embedImage(env, bytes, image.type || 'image/jpeg');
    timings.embedding_ms = Date.now() - embeddingStarted;
    timings.model = embedding.model;

    let covers;
    try {
      covers = await queryVectorize(env, embedding.values, timings);
    } catch (error) {
      // Se Vectorize estiver momentaneamente indisponível, mantém o D1 como fallback de continuidade.
      timings.vectorize_error = error?.message || 'Falha no Vectorize';
      return buildLegacyCandidates(request, env);
    }

    if (!covers.length) {
      timings.vectorize_empty = true;
      return buildLegacyCandidates(request, env);
    }

    timings.cover_candidate_count = covers.length;
    timings.retrieval_top1 = covers[0]?.retrieval_score ?? null;
    timings.retrieval_top1_code = covers[0]?.capa_code || null;
    timings.retrieval_top2 = covers[1]?.retrieval_score ?? null;
    timings.retrieval_top2_code = covers[1]?.capa_code || null;
    timings.retrieval_margin = covers.length > 1
      ? Number(covers[0].retrieval_score || 0) - Number(covers[1].retrieval_score || 0)
      : 1;

    const candidates = await attachRegisteredMockups(env, covers, timings);
    if (!candidates.length) throw new RetrievalError('Nenhuma referência visual disponível para comparação.', 503, 'candidate_images_missing');

    timings.total_ms = Date.now() - started;
    const payload = {
      exp: Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS,
      nonce: crypto.randomUUID(),
      codes: [...new Set(candidates.map(candidate => candidate.capa_code))],
      scores: Object.fromEntries(covers.map(cover => [cover.capa_code, cover.retrieval_score])),
      performance: timings
    };
    const ticket = await signTicket(env, payload);

    return json({ ok: true, ticket, candidates, performance: timings });
  } catch (error) {
    timings.total_ms = Date.now() - started;
    return json({
      error: error?.message || 'Falha ao localizar candidatas no Vectorize',
      technical_error: error?.code || 'vector_retrieval_error',
      performance: timings
    }, Number(error?.status) || 500);
  }
}
