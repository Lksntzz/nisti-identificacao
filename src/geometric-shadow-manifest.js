import { normalizePlatform, platformNamespace } from './platform-scope.js';
import { canonicalizeActiveVectorMatches } from './vector-match-authority.js';

const VECTOR_TOP_K = 50;
const CANDIDATE_COVER_LIMIT = 10;
const REFERENCE_POOL_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

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

function parseEmbedding(value) {
  try {
    const vector = JSON.parse(String(value || ''));
    if (!Array.isArray(vector) || !vector.length) return null;
    if (!vector.every(item => Number.isFinite(Number(item)))) return null;
    return vector.map(Number);
  } catch {
    return null;
  }
}

function versionFromKey(imageKey) {
  return String(imageKey || '').split('/').pop() || 'current';
}

function isHeldOutSelf(metadata, sample) {
  const selfReferenceId = Number(sample?.reference_id || 0);
  const selfImageKey = String(sample?.image_key || '').trim();
  const referenceId = Number(metadata?.reference_id || 0);
  const imageKey = String(metadata?.image_key || '').trim();
  if (selfReferenceId > 0 && referenceId === selfReferenceId) return true;
  if (selfImageKey && imageKey && imageKey === selfImageKey) return true;
  return false;
}

function referencePayload(match, vectorRank) {
  const metadata = match?.metadata || {};
  const referenceId = Number(metadata.reference_id || 0);
  const imageKey = String(metadata.image_key || '').trim();
  const capaCode = normalizeCode(metadata.capa_code);
  const score = Number(match?.score);
  if (!capaCode || !Number.isFinite(score) || !referenceId || !imageKey) return null;
  return {
    vector_rank: vectorRank,
    capa_code: capaCode,
    retrieval_score: score,
    reference_id: referenceId,
    reference_kind: String(metadata.reference_kind || 'product').trim().toLowerCase() || 'product',
    image_key: imageKey,
    image_url: `/api/reference-images/${referenceId}?v=${encodeURIComponent(versionFromKey(imageKey))}`
  };
}

export function buildGeometricReferencePool(matches, sample, limit = REFERENCE_POOL_LIMIT) {
  const seenReferences = new Set();
  const pool = [];
  let vectorRank = 0;

  for (const match of matches || []) {
    vectorRank += 1;
    const metadata = match?.metadata || {};
    if (isHeldOutSelf(metadata, sample)) continue;
    const item = referencePayload(match, vectorRank);
    if (!item || seenReferences.has(item.reference_id)) continue;
    seenReferences.add(item.reference_id);
    pool.push(item);
    if (pool.length >= limit) break;
  }

  return pool;
}

export function buildGeometricCandidateRanking(matches, sample, limit = CANDIDATE_COVER_LIMIT) {
  const pool = buildGeometricReferencePool(matches, sample, Math.max(limit, (matches || []).length));
  const seen = new Set();
  const ranking = [];

  for (const item of pool) {
    if (seen.has(item.capa_code)) continue;
    seen.add(item.capa_code);
    ranking.push({
      ...item,
      cover_rank: ranking.length + 1
    });
    if (ranking.length >= limit) break;
  }

  return ranking;
}

async function readSamples(env, limit, offset) {
  const { results } = await env.DB.prepare(`
    SELECT
      o.id AS occurrence_id,
      o.image_key,
      o.platform,
      o.trained_capa_code,
      r.id AS reference_id,
      e.embedding_json
    FROM scan_occurrences o
    JOIN cover_visual_references r
      ON r.image_key=o.image_key
     AND UPPER(TRIM(r.capa_code))=UPPER(TRIM(o.trained_capa_code))
    JOIN cover_reference_embeddings e
      ON e.reference_id=r.id
    WHERE o.status='trained'
      AND o.trained_capa_code IS NOT NULL
      AND TRIM(o.trained_capa_code) <> ''
      AND o.platform IS NOT NULL
      AND TRIM(o.platform) <> ''
      AND r.active=1
    ORDER BY o.id DESC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();
  return results || [];
}

async function buildSampleManifest(env, sample) {
  const platform = normalizePlatform(sample.platform);
  const vector = parseEmbedding(sample.embedding_json);
  if (!platform) return { status: 'skipped', reason: 'platform_invalid', occurrence_id: Number(sample.occurrence_id) || null };
  if (!vector) return { status: 'skipped', reason: 'embedding_invalid', occurrence_id: Number(sample.occurrence_id) || null };

  const response = await env.COVER_VECTORS.query(vector, {
    topK: VECTOR_TOP_K,
    namespace: platformNamespace(platform),
    returnValues: false,
    returnMetadata: 'all'
  });
  const authoritativeMatches = await canonicalizeActiveVectorMatches(env, response?.matches || []);
  const referencePool = buildGeometricReferencePool(authoritativeMatches, sample, REFERENCE_POOL_LIMIT);
  const candidates = buildGeometricCandidateRanking(authoritativeMatches, sample, CANDIDATE_COVER_LIMIT);
  if (!referencePool.length || !candidates.length) {
    return {
      status: 'skipped',
      reason: 'no_candidates_after_holdout',
      occurrence_id: Number(sample.occurrence_id) || null,
      platform,
      ground_truth: normalizeCode(sample.trained_capa_code)
    };
  }

  const groundTruth = normalizeCode(sample.trained_capa_code);
  const correct = candidates.find(item => item.capa_code === groundTruth) || null;
  return {
    status: 'ready',
    occurrence_id: Number(sample.occurrence_id) || null,
    platform,
    ground_truth: groundTruth,
    occurrence_image_url: `/api/occurrence-images/${Number(sample.occurrence_id)}`,
    vector_top1: candidates[0]?.capa_code || null,
    vector_top1_score: candidates[0]?.retrieval_score ?? null,
    correct_cover_rank_within_top10: correct?.cover_rank ?? null,
    candidates,
    candidate_reference_pool: referencePool
  };
}

export async function handleGeometricShadowManifestRequest(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/admin/geometric-shadow-manifest') return null;
  if (!env?.DB || !env?.COVER_VECTORS?.query) {
    return json({ error: 'D1/Vectorize não configurado para geometric shadow benchmark.' }, 503);
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body?.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(body?.offset) || 0);
  const samples = await readSamples(env, limit, offset);
  const results = [];

  for (const sample of samples) {
    try {
      results.push(await buildSampleManifest(env, sample));
    } catch (error) {
      results.push({
        status: 'skipped',
        reason: 'manifest_query_failed',
        occurrence_id: Number(sample?.occurrence_id || 0) || null,
        error: String(error?.message || error).slice(0, 180)
      });
    }
  }

  return json({
    ok: true,
    methodology: 'held-out+d1-authoritative+platform-scoped+vector-top50-reference-pool-for-browser-content-holdout',
    production_changed: false,
    vector_top_k: VECTOR_TOP_K,
    candidate_cover_limit: CANDIDATE_COVER_LIMIT,
    reference_pool_limit: REFERENCE_POOL_LIMIT,
    pagination: {
      offset,
      limit,
      returned: samples.length,
      next_offset: samples.length === limit ? offset + limit : null
    },
    results
  });
}
