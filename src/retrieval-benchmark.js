import { normalizePlatform, platformNamespace } from './platform-scope.js';
import { evaluateRetrievalFastPath } from './retrieval-fastpath.js';

const VECTOR_TOP_K = 50;
const COVER_LIMIT = 4;
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

export function aggregateHeldOutMatches(matches, sample) {
  const selfReferenceId = Number(sample?.reference_id || 0);
  const selfImageKey = String(sample?.image_key || '').trim();
  const byCode = new Map();
  let rank = 0;

  for (const match of matches || []) {
    rank += 1;
    const metadata = match?.metadata || {};
    const referenceId = Number(metadata.reference_id || 0);
    const imageKey = String(metadata.image_key || '').trim();

    // Hold-out real: nunca permita que a própria foto treinada se reconheça.
    if (selfReferenceId > 0 && referenceId === selfReferenceId) continue;
    if (selfImageKey && imageKey && imageKey === selfImageKey) continue;

    const capaCode = normalizeCode(metadata.capa_code);
    const score = finiteNumber(match?.score);
    if (!capaCode || score === null || byCode.has(capaCode)) continue;

    byCode.set(capaCode, {
      capa_code: capaCode,
      retrieval_score: score,
      vector_rank: rank,
      reference_id: referenceId || null,
      reference_kind: String(metadata.reference_kind || 'product').trim().toLowerCase() || 'product'
    });

    if (byCode.size >= COVER_LIMIT) break;
  }

  return [...byCode.values()];
}

export function evaluateHeldOutSample(sample, matches, env = {}) {
  const groundTruth = normalizeCode(sample?.trained_capa_code);
  const covers = aggregateHeldOutMatches(matches, sample);
  const top1 = covers[0] || null;
  const top2 = covers[1] || null;
  const margin = top1 && top2
    ? Number(top1.retrieval_score) - Number(top2.retrieval_score)
    : null;

  if (!groundTruth) {
    return {
      status: 'skipped',
      reason: 'ground_truth_missing',
      occurrence_id: Number(sample?.occurrence_id || 0) || null
    };
  }

  if (!top1 || !top2 || margin === null) {
    return {
      status: 'skipped',
      reason: 'insufficient_competitors_after_holdout',
      occurrence_id: Number(sample?.occurrence_id || 0) || null,
      ground_truth: groundTruth,
      cover_count: covers.length
    };
  }

  const ticket = {
    codes: [top1.capa_code],
    references: [{
      reference_id: top1.reference_id,
      capa_code: top1.capa_code,
      retrieval_score: top1.retrieval_score,
      vector_rank: top1.vector_rank,
      reference_kind: top1.reference_kind
    }],
    performance: {
      retrieval_top1: top1.retrieval_score,
      retrieval_top1_code: top1.capa_code,
      retrieval_top2: top2.retrieval_score,
      retrieval_top2_code: top2.capa_code,
      retrieval_margin: margin,
      cover_candidate_count: covers.length
    }
  };

  const decision = evaluateRetrievalFastPath(ticket, env);
  const top1Correct = top1.capa_code === groundTruth;
  const accepted = decision.eligible === true;

  return {
    status: 'evaluated',
    occurrence_id: Number(sample?.occurrence_id || 0) || null,
    platform: normalizePlatform(sample?.platform) || null,
    ground_truth: groundTruth,
    top1_code: top1.capa_code,
    top1_score: top1.retrieval_score,
    top2_code: top2.capa_code,
    top2_score: top2.retrieval_score,
    margin,
    cover_count: covers.length,
    top1_correct: top1Correct,
    fastpath_accepted: accepted,
    fastpath_correct: accepted && top1Correct,
    false_positive: accepted && !top1Correct,
    gate_reason: decision.reason,
    reference_kind: top1.reference_kind
  };
}

export function summarizeHeldOutResults(results) {
  const evaluated = (results || []).filter(item => item.status === 'evaluated');
  const skipped = (results || []).filter(item => item.status !== 'evaluated');
  const top1Correct = evaluated.filter(item => item.top1_correct).length;
  const accepted = evaluated.filter(item => item.fastpath_accepted).length;
  const acceptedCorrect = evaluated.filter(item => item.fastpath_correct).length;
  const falsePositives = evaluated.filter(item => item.false_positive).length;

  const perCover = new Map();
  for (const item of evaluated) {
    const code = item.ground_truth;
    if (!perCover.has(code)) {
      perCover.set(code, {
        capa_code: code,
        samples: 0,
        top1_correct: 0,
        fastpath_accepted: 0,
        fastpath_correct: 0,
        false_positives: 0
      });
    }
    const row = perCover.get(code);
    row.samples += 1;
    if (item.top1_correct) row.top1_correct += 1;
    if (item.fastpath_accepted) row.fastpath_accepted += 1;
    if (item.fastpath_correct) row.fastpath_correct += 1;
    if (item.false_positive) row.false_positives += 1;
  }

  return {
    samples_total: (results || []).length,
    evaluated: evaluated.length,
    skipped: skipped.length,
    top1_correct: top1Correct,
    top1_accuracy: evaluated.length ? top1Correct / evaluated.length : null,
    fastpath_accepted: accepted,
    fastpath_coverage: evaluated.length ? accepted / evaluated.length : null,
    fastpath_correct: acceptedCorrect,
    fastpath_precision: accepted ? acceptedCorrect / accepted : null,
    false_positives: falsePositives,
    safe_for_global_rollout: evaluated.length >= 30 && falsePositives === 0,
    per_cover: [...perCover.values()].sort((a, b) => a.capa_code.localeCompare(b.capa_code))
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

  return evaluateHeldOutSample(sample, response?.matches || [], env);
}

export async function handleRetrievalBenchmarkRequest(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/admin/retrieval-benchmark') {
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

  // Sequencial por design: evita rajadas no Vectorize e torna o benchmark reproduzível.
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

  const summary = summarizeHeldOutResults(results);
  return json({
    ok: true,
    methodology: 'held-out-trained-occurrences-self-reference-excluded',
    thresholds: {
      min_score: Number(env.RETRIEVAL_FASTPATH_MIN_SCORE || 0.92),
      min_margin: Number(env.RETRIEVAL_FASTPATH_MIN_MARGIN || 0.008)
    },
    pagination: {
      offset,
      limit,
      returned: samples.length,
      next_offset: samples.length === limit ? offset + limit : null
    },
    summary,
    results
  });
}
