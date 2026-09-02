import { normalizePlatform, platformNamespace } from './platform-scope.js';
import { evaluateRetrievalFastPath } from './retrieval-fastpath.js';
import { canonicalizeActiveVectorMatches } from './vector-match-authority.js';

const VECTOR_TOP_K = 50;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_REFERENCES_PER_COVER = 3;

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

function referenceFromMatch(match, vectorRank) {
  const metadata = match?.metadata || {};
  const referenceId = Number(metadata.reference_id || 0);
  const score = finiteNumber(match?.score);
  return {
    reference_id: Number.isInteger(referenceId) && referenceId > 0 ? referenceId : null,
    image_key: String(metadata.image_key || '').trim() || null,
    reference_kind: String(metadata.reference_kind || 'product').trim().toLowerCase() || 'product',
    vector_rank: vectorRank,
    score
  };
}

/**
 * Shadow aggregation only. Production ranking is intentionally untouched.
 * Groups up to three distinct active D1 references per CAPA_CODE while
 * excluding the held-out sample itself.
 */
export function aggregateMultiReferenceMatches(matches, sample) {
  const selfReferenceId = Number(sample?.reference_id || 0);
  const selfImageKey = String(sample?.image_key || '').trim();
  const byCode = new Map();
  let vectorRank = 0;

  for (const match of matches || []) {
    vectorRank += 1;
    const metadata = match?.metadata || {};
    const capaCode = normalizeCode(metadata.capa_code);
    const reference = referenceFromMatch(match, vectorRank);

    if (!capaCode || reference.score === null || !reference.reference_id || !reference.image_key) {
      continue;
    }
    if (selfReferenceId > 0 && reference.reference_id === selfReferenceId) continue;
    if (selfImageKey && reference.image_key === selfImageKey) continue;

    let cover = byCode.get(capaCode);
    if (!cover) {
      cover = {
        capa_code: capaCode,
        references: []
      };
      byCode.set(capaCode, cover);
    }

    const duplicate = cover.references.some(item =>
      item.reference_id === reference.reference_id ||
      (item.image_key && item.image_key === reference.image_key)
    );
    if (!duplicate && cover.references.length < MAX_REFERENCES_PER_COVER) {
      cover.references.push(reference);
    }
  }

  return [...byCode.values()]
    .filter(cover => cover.references.length > 0)
    .map(cover => {
      const refs = [...cover.references].sort((a, b) => b.score - a.score);
      const kinds = [...new Set(refs.map(item => item.reference_kind))];
      return {
        capa_code: cover.capa_code,
        best_score: refs[0]?.score ?? null,
        second_reference_score: refs[1]?.score ?? null,
        support_count: refs.length,
        reference_kinds: kinds,
        references: refs
      };
    })
    .sort((a, b) => Number(b.best_score || 0) - Number(a.best_score || 0));
}

function fastPathDecision(top1, top2, env) {
  if (!top1 || !top2) return { eligible: false, reason: 'competitor_missing' };
  const reference = top1.references[0];
  return evaluateRetrievalFastPath({
    codes: [top1.capa_code],
    references: [{
      reference_id: reference?.reference_id || null,
      capa_code: top1.capa_code,
      retrieval_score: top1.best_score,
      vector_rank: reference?.vector_rank || 1,
      reference_kind: reference?.reference_kind || 'product'
    }],
    performance: {
      retrieval_top1: top1.best_score,
      retrieval_top1_code: top1.capa_code,
      retrieval_top2: top2.best_score,
      retrieval_top2_code: top2.capa_code,
      retrieval_margin: Number(top1.best_score) - Number(top2.best_score),
      cover_candidate_count: 2
    }
  }, env);
}

export function evaluateMultiReferenceShadow(sample, matches, env = {}) {
  const groundTruth = normalizeCode(sample?.trained_capa_code);
  if (!groundTruth) {
    return {
      status: 'skipped',
      reason: 'ground_truth_missing',
      occurrence_id: Number(sample?.occurrence_id || 0) || null
    };
  }

  const covers = aggregateMultiReferenceMatches(matches, sample);
  const top1 = covers[0] || null;
  const top2 = covers[1] || null;
  if (!top1 || !top2) {
    return {
      status: 'skipped',
      reason: 'insufficient_competitors_after_holdout',
      occurrence_id: Number(sample?.occurrence_id || 0) || null,
      ground_truth: groundTruth,
      cover_count: covers.length
    };
  }

  const top2Best = Number(top2.best_score);
  const refsAboveTop2 = top1.references.filter(ref => Number(ref.score) > top2Best);
  const kindsAboveTop2 = [...new Set(refsAboveTop2.map(ref => ref.reference_kind))];
  const rankConsensus = refsAboveTop2.length >= 2;
  const diverseRankConsensus =
    rankConsensus &&
    kindsAboveTop2.includes('product') &&
    kindsAboveTop2.includes('real_scan');

  const currentDecision = fastPathDecision(top1, top2, env);
  const currentAccepted = currentDecision.eligible === true;
  const top1Correct = top1.capa_code === groundTruth;

  return {
    status: 'evaluated',
    occurrence_id: Number(sample?.occurrence_id || 0) || null,
    platform: normalizePlatform(sample?.platform) || null,
    ground_truth: groundTruth,
    top1_code: top1.capa_code,
    top1_best_score: top1.best_score,
    top1_second_reference_score: top1.second_reference_score,
    top1_support_count: top1.support_count,
    top1_reference_kinds: top1.reference_kinds,
    top2_code: top2.capa_code,
    top2_best_score: top2.best_score,
    inter_cover_margin: Number(top1.best_score) - Number(top2.best_score),
    top1_references_above_top2: refsAboveTop2.length,
    top1_kinds_above_top2: kindsAboveTop2,
    top1_correct: top1Correct,
    current_fastpath_accepted: currentAccepted,
    current_fastpath_correct: currentAccepted && top1Correct,
    current_fastpath_reason: currentDecision.reason,
    rank_consensus: rankConsensus,
    rank_consensus_correct: rankConsensus && top1Correct,
    rank_consensus_false_positive: rankConsensus && !top1Correct,
    diverse_rank_consensus: diverseRankConsensus,
    diverse_rank_consensus_correct: diverseRankConsensus && top1Correct,
    diverse_rank_consensus_false_positive: diverseRankConsensus && !top1Correct,
    incremental_rank_consensus: rankConsensus && !currentAccepted,
    incremental_rank_consensus_correct: rankConsensus && !currentAccepted && top1Correct,
    incremental_rank_consensus_false_positive: rankConsensus && !currentAccepted && !top1Correct,
    incremental_diverse_rank_consensus: diverseRankConsensus && !currentAccepted,
    incremental_diverse_rank_consensus_correct:
      diverseRankConsensus && !currentAccepted && top1Correct,
    incremental_diverse_rank_consensus_false_positive:
      diverseRankConsensus && !currentAccepted && !top1Correct
  };
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

export function summarizeMultiReferenceShadow(results) {
  const evaluated = (results || []).filter(item => item.status === 'evaluated');
  const rank = evaluated.filter(item => item.rank_consensus);
  const diverse = evaluated.filter(item => item.diverse_rank_consensus);
  const incrementalRank = evaluated.filter(item => item.incremental_rank_consensus);
  const incrementalDiverse = evaluated.filter(item => item.incremental_diverse_rank_consensus);
  const current = evaluated.filter(item => item.current_fastpath_accepted);

  const correct = items => items.filter(item => item.top1_correct).length;
  const falsePositives = items => items.filter(item => !item.top1_correct).length;

  return {
    samples_total: (results || []).length,
    evaluated: evaluated.length,
    skipped: (results || []).length - evaluated.length,
    current_fastpath: {
      accepted: current.length,
      correct: correct(current),
      false_positives: falsePositives(current),
      precision: ratio(correct(current), current.length),
      coverage: ratio(current.length, evaluated.length)
    },
    rank_consensus_shadow: {
      accepted: rank.length,
      correct: correct(rank),
      false_positives: falsePositives(rank),
      precision: ratio(correct(rank), rank.length),
      coverage: ratio(rank.length, evaluated.length)
    },
    diverse_rank_consensus_shadow: {
      accepted: diverse.length,
      correct: correct(diverse),
      false_positives: falsePositives(diverse),
      precision: ratio(correct(diverse), diverse.length),
      coverage: ratio(diverse.length, evaluated.length)
    },
    incremental_rank_consensus: {
      candidates: incrementalRank.length,
      correct: correct(incrementalRank),
      false_positives: falsePositives(incrementalRank),
      precision: ratio(correct(incrementalRank), incrementalRank.length)
    },
    incremental_diverse_rank_consensus: {
      candidates: incrementalDiverse.length,
      correct: correct(incrementalDiverse),
      false_positives: falsePositives(incrementalDiverse),
      precision: ratio(correct(incrementalDiverse), incrementalDiverse.length)
    },
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

  return evaluateMultiReferenceShadow(sample, authoritativeMatches, env);
}

export async function handleRetrievalConsensusBenchmarkRequest(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/admin/retrieval-consensus-benchmark') {
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
    methodology: 'held-out+d1-authoritative+multi-reference-shadow-no-production-change',
    production_changed: false,
    consensus_definition: {
      rank_consensus: 'at least two distinct Top-1 references score above the best competing CAPA_CODE reference',
      diverse_rank_consensus: 'rank consensus with both product and real_scan references above the competitor'
    },
    pagination: {
      offset,
      limit,
      returned: samples.length,
      next_offset: samples.length === limit ? offset + limit : null
    },
    summary: summarizeMultiReferenceShadow(results),
    results
  });
}
