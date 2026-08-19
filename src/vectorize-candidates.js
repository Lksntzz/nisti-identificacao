import { buildLocalVisionCandidates as buildLegacyCandidates } from './embedding-candidates.js';

const EMBEDDING_DIMENSIONS = 768;
const VECTOR_TOP_K = 24;
const COVER_LIMIT = 6;
const REFERENCES_PER_COVER = 2;
const MAX_REFERENCE_CANDIDATES = 8;
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
  if (!env.GEMINI_API_KEY) {
    throw new RetrievalError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');
  }
  const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('embedding-timeout'), MAX_EMBEDDING_MS);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
      {
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
      }
    );
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

function referenceFromMatch(match, vectorRank) {
  const referenceId = Number(match?.metadata?.reference_id || 0);
  return {
    reference_id: Number.isInteger(referenceId) && referenceId > 0 ? referenceId : null,
    source_product_id: Number(match?.metadata?.source_product_id || 0) || null,
    reference_kind: String(match?.metadata?.reference_kind || (referenceId ? 'product' : 'legacy')),
    image_key: match?.metadata?.image_key || null,
    vector_id: String(match?.id || ''),
    vector_rank: vectorRank,
    retrieval_score: Number(match?.score || 0)
  };
}

async function queryVectorize(env, vector, timings) {
  if (!env.COVER_VECTORS?.query) {
    throw new RetrievalError('Vectorize não configurado', 503, 'vectorize_not_configured');
  }

  const started = Date.now();
  const result = await env.COVER_VECTORS.query(vector, {
    topK: VECTOR_TOP_K,
    returnValues: false,
    returnMetadata: 'all'
  });
  timings.vectorize_ms = Date.now() - started;
  timings.vectorize_count = Number(result?.count || result?.matches?.length || 0);

  const byCode = new Map();
  let vectorRank = 0;
  for (const match of result?.matches || []) {
    vectorRank += 1;
    const capaCode = codeFromMatch(match);
    if (!capaCode) continue;

    let cover = byCode.get(capaCode);
    if (!cover) {
      cover = {
        capa_code: capaCode,
        retrieval_rank: byCode.size + 1,
        retrieval_score: Number(match?.score || 0),
        references: []
      };
      byCode.set(capaCode, cover);
    }

    const reference = referenceFromMatch(match, vectorRank);
    const duplicate = cover.references.some(item =>
      reference.reference_id
        ? item.reference_id === reference.reference_id
        : item.vector_id === reference.vector_id
    );
    if (!duplicate && cover.references.length < REFERENCES_PER_COVER) {
      cover.references.push(reference);
    }
  }

  return [...byCode.values()].slice(0, COVER_LIMIT);
}

async function legacyReferenceCandidates(env, coverCodes) {
  if (!coverCodes.length) return new Map();
  const placeholders = coverCodes.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT id,sku,capa_code,image_key,updated_at
    FROM products
    WHERE capa_code IN (${placeholders}) AND image_key IS NOT NULL
    ORDER BY id DESC
  `).bind(...coverCodes).all();

  const byCode = new Map(coverCodes.map(code => [code, []]));
  for (const product of results || []) {
    const code = String(product.capa_code || '').trim().toUpperCase();
    if (!byCode.has(code)) continue;
    const list = byCode.get(code);
    if (list.length >= REFERENCES_PER_COVER) continue;
    list.push(product);
  }
  return byCode;
}

async function buildCandidates(env, covers, timings) {
  if (!covers.length) return [];
  const started = Date.now();
  const missingCodes = covers
    .filter(cover => !cover.references.some(ref => ref.reference_id && ref.image_key))
    .map(cover => cover.capa_code);
  const legacyByCode = await legacyReferenceCandidates(env, missingCodes);

  const primary = [];
  const secondary = [];

  for (const cover of covers) {
    const validRefs = cover.references.filter(ref => ref.reference_id && ref.image_key);
    if (validRefs.length) {
      for (let index = 0; index < validRefs.length; index += 1) {
        const ref = validRefs[index];
        const version = String(ref.image_key || '').split('/').pop() || 'current';
        const candidate = {
          reference_id: ref.reference_id,
          product_id: ref.source_product_id,
          capa_code: cover.capa_code,
          retrieval_rank: cover.retrieval_rank,
          vector_rank: ref.vector_rank,
          retrieval_score: ref.retrieval_score,
          reference_kind: ref.reference_kind,
          image_key: ref.image_key,
          image_url: `/api/reference-images/${ref.reference_id}?v=${encodeURIComponent(version)}`
        };
        (index === 0 ? primary : secondary).push(candidate);
      }
      continue;
    }

    const products = legacyByCode.get(cover.capa_code) || [];
    for (let index = 0; index < products.length; index += 1) {
      const product = products[index];
      const version = String(product.image_key || '').split('/').pop() || 'current';
      const candidate = {
        reference_id: null,
        product_id: Number(product.id),
        sku: product.sku,
        capa_code: cover.capa_code,
        retrieval_rank: cover.retrieval_rank,
        vector_rank: cover.references[0]?.vector_rank || cover.retrieval_rank,
        retrieval_score: cover.retrieval_score,
        reference_kind: 'legacy-product',
        image_key: product.image_key,
        image_url: `/api/images/${product.id}?v=${encodeURIComponent(version)}`
      };
      (index === 0 ? primary : secondary).push(candidate);
    }
  }

  // Primeiro uma referência por capa para maximizar diversidade; só depois
  // adicionamos a segunda referência dos melhores grupos.
  const candidates = [...primary, ...secondary].slice(0, MAX_REFERENCE_CANDIDATES);
  timings.candidate_lookup_ms = Date.now() - started;
  timings.reference_candidate_count = candidates.length;
  timings.multi_reference_candidates = candidates.filter(item => item.reference_id).length;
  return candidates;
}

export async function buildVectorizeCandidates(request, env) {
  if (!env.COVER_VECTORS?.query) return buildLegacyCandidates(request, env);

  // Clona antes de consumir formData para permitir fallback ao pipeline D1 sem perder o corpo.
  const legacyRequest = request.clone();
  const started = Date.now();
  const timings = {
    pipeline_version: 'gemini-embedding+vectorize-multiref-v2',
    retrieval_source: 'vectorize-multi-reference',
    vector_top_k: VECTOR_TOP_K
  };

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
      timings.vectorize_error = error?.message || 'Falha no Vectorize';
      return buildLegacyCandidates(legacyRequest, env);
    }

    if (!covers.length) {
      timings.vectorize_empty = true;
      return buildLegacyCandidates(legacyRequest, env);
    }

    timings.cover_candidate_count = covers.length;
    timings.retrieval_top1 = covers[0]?.retrieval_score ?? null;
    timings.retrieval_top1_code = covers[0]?.capa_code || null;
    timings.retrieval_top2 = covers[1]?.retrieval_score ?? null;
    timings.retrieval_top2_code = covers[1]?.capa_code || null;
    timings.retrieval_margin = covers.length > 1
      ? Number(covers[0].retrieval_score || 0) - Number(covers[1].retrieval_score || 0)
      : 1;

    const candidates = await buildCandidates(env, covers, timings);
    if (!candidates.length) {
      throw new RetrievalError(
        'Nenhuma referência visual disponível para comparação.',
        503,
        'candidate_images_missing'
      );
    }

    timings.total_ms = Date.now() - started;
    const payload = {
      exp: Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS,
      nonce: crypto.randomUUID(),
      codes: covers.map(cover => cover.capa_code),
      scores: Object.fromEntries(covers.map(cover => [cover.capa_code, cover.retrieval_score])),
      references: candidates
        .filter(candidate => candidate.reference_id)
        .map(candidate => ({
          reference_id: candidate.reference_id,
          capa_code: candidate.capa_code,
          retrieval_score: candidate.retrieval_score,
          vector_rank: candidate.vector_rank
        })),
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
