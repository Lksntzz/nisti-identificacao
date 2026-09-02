import { listPlatforms, normalizePlatform, platformExists, platformNamespace } from './platform-scope.js';

const EMBEDDING_DIMENSIONS = 768;
const VECTOR_TOP_K = 50;
const COVER_LIMIT = 10;
const REFERENCES_PER_COVER = 1;
const MAX_REFERENCE_CANDIDATES = 10;
const TICKET_TTL_SECONDS = 120;
const MAX_EMBEDDING_MS = 5000;
const MIN_PLATFORM_RETRIEVAL_SCORE = 0.45;
const CROSS_PLATFORM_MATCH_SCORE = 0.58;

class RetrievalError extends Error {
  constructor(message, status = 400, code = 'vector_retrieval_error', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
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

import { Buffer } from 'node:buffer';

function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
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
    ['sign']
  );
}

async function signTicket(env, payload) {
  const secret = String(env.TICKET_SECRET || env.ADMIN_PASSWORD || env.GEMINI_API_KEY || '');
  if (!secret) {
    throw new RetrievalError(
      'Chave de segurança para tickets não configurada',
      503,
      'ticket_secret_not_configured'
    );
  }
  const encoded = base64url(textBytes(JSON.stringify(payload)));
  const key = await ticketKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, textBytes(encoded))
  );
  return `${encoded}.${base64url(signature)}`;
}

export async function embedImage(env, bytes, mimeType, maxRetries = 3) {
  if (!env.GEMINI_API_KEY) {
    throw new RetrievalError(
      'GEMINI_API_KEY não configurada',
      500,
      'missing_gemini_key'
    );
  }

  const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const base64Data = base64(bytes);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort('embedding-timeout'),
      MAX_EMBEDDING_MS
    );

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
                  data: base64Data
                }
              }]
            },
            output_dimensionality: EMBEDDING_DIMENSIONS
          })
        }
      );

      if (!response.ok) {
        if (attempt < maxRetries && [429, 500, 502, 503, 504].includes(response.status)) {
          await new Promise(r => setTimeout(r, attempt * 350));
          continue;
        }
        throw new RetrievalError(
          `Gemini Embedding falhou (${response.status})`,
          [429, 500, 502, 503, 504].includes(response.status) ? 503 : 502,
          'embedding_failed'
        );
      }

      const payload = await response.json();
      const values = payload?.embedding?.values || payload?.embeddings?.[0]?.values;
      if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
        throw new RetrievalError(
          'Gemini Embedding não retornou vetor válido',
          502,
          'embedding_empty'
        );
      }

      return { model, values };
    } catch (error) {
      if (attempt < maxRetries && error?.name !== 'RetrievalError') {
        await new Promise(r => setTimeout(r, attempt * 350));
        continue;
      }
      if (controller.signal.aborted || error?.name === 'AbortError') {
        throw new RetrievalError(
          'O embedding da imagem excedeu o tempo máximo.',
          503,
          'embedding_timeout'
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function codeFromMatch(match) {
  return String(match?.metadata?.capa_code || '').trim().toUpperCase();
}

function referenceFromMatch(match, vectorRank) {
  const referenceId = Number(match?.metadata?.reference_id || 0);
  return {
    reference_id: Number.isInteger(referenceId) && referenceId > 0
      ? referenceId
      : null,
    source_product_id: Number(match?.metadata?.source_product_id || 0) || null,
    reference_kind: String(match?.metadata?.reference_kind || 'product'),
    image_key: match?.metadata?.image_key || null,
    platform: normalizePlatform(match?.metadata?.platform),
    vector_id: String(match?.id || ''),
    vector_rank: vectorRank,
    retrieval_score: Number(match?.score || 0)
  };
}

async function queryVectorize(env, vector, timings, platform) {
  if (!env.COVER_VECTORS?.query) {
    throw new RetrievalError(
      'Vectorize não configurado',
      503,
      'vectorize_not_configured'
    );
  }

  const namespace = platformNamespace(platform);
  if (!namespace) {
    throw new RetrievalError(
      'Plataforma inválida',
      400,
      'platform_invalid'
    );
  }

  const started = Date.now();
  const result = await env.COVER_VECTORS.query(vector, {
    topK: VECTOR_TOP_K,
    namespace,
    returnValues: false,
    returnMetadata: 'all'
  });
  timings.vectorize_ms = Date.now() - started;
  timings.vectorize_count = Number(result?.count || result?.matches?.length || 0);
  timings.vectorize_namespace = namespace;

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
    if (!reference.reference_id || !reference.image_key) continue;

    if (
      !cover.references.some(item => item.reference_id === reference.reference_id) &&
      cover.references.length < REFERENCES_PER_COVER
    ) {
      cover.references.push(reference);
    }
  }

  return [...byCode.values()]
    .filter(cover => cover.references.length > 0)
    .slice(0, COVER_LIMIT)
    .map((cover, index) => ({
      ...cover,
      retrieval_rank: index + 1
    }));
}

function buildCandidates(covers, timings) {
  const started = Date.now();
  const candidates = [];

  for (const cover of covers) {
    for (const ref of cover.references) {
      const version = String(ref.image_key || '').split('/').pop() || 'current';
      candidates.push({
        reference_id: ref.reference_id,
        product_id: ref.source_product_id,
        capa_code: cover.capa_code,
        retrieval_rank: cover.retrieval_rank,
        vector_rank: ref.vector_rank,
        retrieval_score: cover.retrieval_score,
        reference_kind: ref.reference_kind,
        platform: ref.platform,
        image_key: ref.image_key,
        image_url: `/api/reference-images/${ref.reference_id}?v=${encodeURIComponent(version)}`
      });
      if (candidates.length >= MAX_REFERENCE_CANDIDATES) break;
    }
    if (candidates.length >= MAX_REFERENCE_CANDIDATES) break;
  }

  timings.candidate_lookup_ms = Date.now() - started;
  timings.reference_candidate_count = candidates.length;
  return candidates;
}

export async function detectCrossPlatformMatch(env, vector, currentPlatform) {
  try {
    const platforms = await listPlatforms(env);
    const otherPlatforms = platforms.filter(
      p => p.platform !== currentPlatform && p.product_count > 0
    );

    let bestMatch = null;
    for (const other of otherPlatforms) {
      const namespace = platformNamespace(other.platform);
      if (!namespace) continue;
      const res = await env.COVER_VECTORS.query(vector, {
        topK: 3,
        namespace,
        returnValues: false,
        returnMetadata: 'all'
      });
      const topMatch = res?.matches?.[0];
      const score = Number(topMatch?.score || 0);
      if (score >= 0.95) {
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            found_platform: other.platform,
            score,
            capa_code: codeFromMatch(topMatch)
          };
        }
      }
    }
    return bestMatch;
  } catch {
    return null;
  }
}

export async function buildVectorizeCandidates(request, env) {
  const started = Date.now();
  const timings = {
    pipeline_version: 'platform-scoped-embedding+vectorize-v2-wide-recall',
    retrieval_source: 'vectorize-platform-namespace',
    vector_top_k: VECTOR_TOP_K
  };

  try {
    const form = await request.formData();
    const image = form.get('image');
    const platform = normalizePlatform(form.get('platform'));

    if (!(image instanceof File)) {
      return json({ error: 'Foto da capa obrigatória' }, 400);
    }
    if (!platform) {
      return json({ error: 'Selecione a plataforma antes de identificar.' }, 400);
    }
    if (!(await platformExists(env, platform))) {
      return json({ error: 'Plataforma não encontrada no catálogo.' }, 400);
    }

    timings.platform = platform;
    timings.platform_key = platformNamespace(platform);

    const readStarted = Date.now();
    const bytes = new Uint8Array(await image.arrayBuffer());
    timings.read_photo_ms = Date.now() - readStarted;
    timings.upload_bytes = image.size;

    const embeddingStarted = Date.now();
    const embedding = await embedImage(env, bytes, image.type || 'image/jpeg');
    timings.embedding_ms = Date.now() - embeddingStarted;
    timings.model = embedding.model;

    const covers = await queryVectorize(
      env,
      embedding.values,
      timings,
      platform
    );

    if (!covers.length) {
      throw new RetrievalError(
        `Produto não cadastrado na plataforma ${platform}. Verifique se a plataforma correta foi selecionada.`,
        422,
        'platform_index_empty'
      );
    }

    timings.cover_candidate_count = covers.length;
    timings.retrieval_top1 = covers[0]?.retrieval_score ?? null;
    timings.retrieval_top1_code = covers[0]?.capa_code || null;
    timings.retrieval_top2 = covers[1]?.retrieval_score ?? null;
    timings.retrieval_top2_code = covers[1]?.capa_code || null;
    timings.retrieval_margin = covers.length > 1
      ? Number(covers[0].retrieval_score || 0) - Number(covers[1].retrieval_score || 0)
      : 1;
    const topScore = Number(covers[0]?.retrieval_score || 0);

    if (topScore < MIN_PLATFORM_RETRIEVAL_SCORE) {
      throw new RetrievalError(
        `Produto não corresponde ao catálogo da plataforma ${platform}. Verifique se a plataforma correta foi selecionada ou se a capa está cadastrada.`,
        422,
        'product_not_found_on_platform'
      );
    }

    const candidates = buildCandidates(covers, timings);
    if (!candidates.length) {
      throw new RetrievalError(
        'Nenhuma referência visual disponível para esta plataforma.',
        503,
        'candidate_images_missing'
      );
    }

    timings.total_ms = Date.now() - started;

    const payload = {
      exp: Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS,
      nonce: crypto.randomUUID(),
      platform,
      platform_key: platformNamespace(platform),
      codes: covers.map(cover => cover.capa_code),
      scores: Object.fromEntries(
        covers.map(cover => [cover.capa_code, cover.retrieval_score])
      ),
      references: candidates.map(candidate => ({
        reference_id: candidate.reference_id,
        capa_code: candidate.capa_code,
        retrieval_score: candidate.retrieval_score,
        vector_rank: candidate.vector_rank,
        reference_kind: candidate.reference_kind
      })),
      performance: timings
    };

    const ticket = await signTicket(env, payload);

    return json({
      ok: true,
      platform,
      ticket,
      candidates,
      performance: timings
    });
  } catch (error) {
    timings.total_ms = Date.now() - started;
    return json({
      error: error?.message || 'Falha ao localizar candidatas no Vectorize',
      technical_error: error?.code || 'vector_retrieval_error',
      suggested_platform: error?.extra?.suggested_platform || null,
      performance: timings
    }, Number(error?.status) || 500);
  }
}