import { normalizePlatform, platformNamespace } from './platform-scope.js';
import { canonicalizeActiveVectorMatches } from './vector-match-authority.js';

const VECTOR_TOP_K = 50;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const RECALL_KS = [1, 3, 5, 10, 20, 50];

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

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseEmbedding(value) {
  try {
    const vector = JSON.parse(String(value || ''));
    if (!Array.isArray(vector) || vector.length === 0) return null;
    if (!vector.every(item => Number.isFinite(Number(item)))) return null;
    return vector.map(Number);
  } catch {
    return null;
  }
}

export function buildDistinctCoverRanking(matches, sample) {
  const selfReferenceId = Number(sample?.reference_id || 0);
  const selfImageKey = String(sample?.image_key || '').trim();
  const seenCodes = new Set();
  const ranking = [];
  let vectorRank = 0;

  for (const match of matches || []) {
    vectorRank += 1;
    const metadata = match?.metadata || {};
    const referenceId = Number(metadata.reference_id || 0);
    const imageKey = String(metadata.image_key || '').trim();

    if (selfReferenceId > 0 && referenceId === selfReferenceId) continue;
    if (selfImageKey && imageKey && imageKey === selfImageKey) continue;

    const capaCode = normalizeCode(metadata.capa_code);
    const score = finiteNumber(match?.score);
    if (!capaCode || score === null || seenCodes.has(capaCode)) continue;

    seenCodes.add(capaCode);
    ranking.push({
      cover_rank: ranking.length + 1,
      vector_rank: vectorRank,
      capa_code: capaCode,
      score,
      reference_id: Number.isInteger(referenceId) && referenceId > 0 ? referenceId : null,
      reference_kind: String(metadata.reference_kind || 'product').trim().toLowerCase() || 'product'
    });
  }

  return ranking;
}

export function evaluateRecallSample(sample, matches) {
  const groundTruth = normalizeCode(sample?.trained_capa_code);
  if (!groundTruth) {
    return {
      status: 'skipped',
      reason: 'ground_truth_missing',
      occurrence_id: Number(sample?.occurrence_id || 0) || null
    };
  }

  const ranking = buildDistinctCoverRanking(matches, sample);
  if (!ranking.length) {
    return {
      status: 'skipped',
      reason: 'no_candidates_after_holdout',
      occurrence_id: Number(sample?.occurrence_id || 0) || null,
      platform: normalizePlatform(sample?.platform) || null,
      ground_truth: groundTruth
    };
  }

  const correct = ranking.find(item => item.capa_code === groundTruth) || null;
  const correctCoverRank = correct?.cover_rank ?? null;
  const hits = Object.fromEntries(
    RECALL_KS.map(k => [`at_${k}`, correctCoverRank !== null && correctCoverRank <= k])
  );

  return {
    status: 'evaluated',
    occurrence_id: Number(sample?.occurrence_id || 0) || null,
    platform: normalizePlatform(sample?.platform) || null,
    ground_truth: groundTruth,
    top1_code: ranking[0]?.capa_code || null,
    top1_score: ranking[0]?.score ?? null,
    correct_cover_rank: correctCoverRank,
    correct_vector_rank: correct?.vector_rank ?? null,
    correct_score: correct?.score ?? null,
    distinct_covers_retrieved: ranking.length,
    missing_within_vector_top50: correctCoverRank === null,
    recall_hits: hits
  };
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function summarizeGroup(items) {
  const evaluated = items.filter(item => item.status === 'evaluated');
  const recall = {};

  for (const k of RECALL_KS) {
    const hits = evaluated.filter(item => item.recall_hits?.[`at_${k}`]).length;
    recall[`at_${k}`] = {
      hits,
      rate: ratio(hits, evaluated.length)
    };
  }

  const missing = evaluated.filter(item => item.missing_within_vector_top50).length;
  return {
    evaluated: evaluated.length,
    recall,
    missing_within_vector_top50: missing,
    missing_rate: ratio(missing, evaluated.length)
  };
}

export function summarizeRecallResults(results) {
  const all = results || [];
  const evaluated = all.filter(item => item.status === 'evaluated');
  const overall = summarizeGroup(evaluated);

  const platformGroups = new Map();
  const coverGroups = new Map();
  for (const item of evaluated) {
    const platform = item.platform || 'UNKNOWN';
    const cover = item.ground_truth || 'UNKNOWN';
    if (!platformGroups.has(platform)) platformGroups.set(platform, []);
    if (!coverGroups.has(cover)) coverGroups.set(cover, []);
    platformGroups.get(platform).push(item);
    coverGroups.get(cover).push(item);
  }

  const byPlatform = [...platformGroups.entries()]
    .map(([platform, items]) => ({ platform, ...summarizeGroup(items) }))
    .sort((a, b) => a.platform.localeCompare(b.platform));

  const byCover = [...coverGroups.entries()]
    .map(([capa_code, items]) => ({ capa_code, ...summarizeGroup(items) }))
    .sort((a, b) => a.capa_code.localeCompare(b.capa_code));

  return {
    samples_total: all.length,
    evaluated: evaluated.length,
    skipped: all.length - evaluated.length,
    vector_top_k: VECTOR_TOP_K,
    ranking_unit: 'distinct_capa_code_after_holdout_and_d1_authority',
    ...overall,
    by_platform: byPlatform,
    by_cover: byCover,
    production_changed: false
  };
}

async function readBenchmarkSamples(env, limit, offset) {
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

async function querySample(env, sample) {
  const platform = normalizePlatform(sample.platform);
  const vector = parseEmbedding(sample.embedding_json);
  if (!platform) {
    return {
      status: 'skipped',
      reason: 'platform_invalid',
      occurrence_id: Number(sample.occurrence_id || 0) || null
    };
  }
  if (!vector) {
    return {
      status: 'skipped',
      reason: 'embedding_invalid',
      occurrence_id: Number(sample.occurrence_id || 0) || null
    };
  }

  const response = await env.COVER_VECTORS.query(vector, {
    topK: VECTOR_TOP_K,
    namespace: platformNamespace(platform),
    returnValues: false,
    returnMetadata: 'all'
  });
  const authoritativeMatches = await canonicalizeActiveVectorMatches(
    env,
    response?.matches || []
  );

  return evaluateRecallSample(sample, authoritativeMatches);
}

export async function handleRetrievalRecallBenchmarkRequest(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/admin/retrieval-recall-benchmark') {
    return null;
  }

  if (!env?.DB || !env?.COVER_VECTORS?.query) {
    return json({ error: 'D1/Vectorize não configurado para benchmark.' }, 503);
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body?.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(body?.offset) || 0);
  const samples = await readBenchmarkSamples(env, limit, offset);
  const results = [];

  for (const sample of samples) {
    try {
      results.push(await querySample(env, sample));
    } catch (error) {
      results.push({
        status: 'skipped',
        reason: 'vectorize_query_failed',
        occurrence_id: Number(sample?.occurrence_id || 0) || null,
        error: String(error?.message || error).slice(0, 180)
      });
    }
  }

  return json({
    ok: true,
    methodology: 'held-out+d1-authoritative+platform-scoped+distinct-cover-recall-within-vector-top50',
    production_changed: false,
    recall_k: RECALL_KS,
    pagination: {
      offset,
      limit,
      returned: samples.length,
      next_offset: samples.length === limit ? offset + limit : null
    },
    summary: summarizeRecallResults(results),
    results
  });
}
