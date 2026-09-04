import { summarizeGeometricShadowEvidence } from './geometric-shadow-evidence-router.js';

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 1000;
const OBSERVABILITY_CACHE_TTL_MS = 5 * 60 * 1000;
const observabilityCacheByLimit = new Map();

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
  return String(value || '').trim().toUpperCase() || null;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseEvidenceJson(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeRetrievalCandidates(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 10)
    .map((candidate, index) => ({
      capa_code: normalizeCode(candidate?.capa_code),
      retrieval_score: finite(candidate?.retrieval_score),
      vector_rank: Number(candidate?.vector_rank || index + 1) || index + 1,
      reference_id: Number(candidate?.reference_id || 0) || null,
      reference_kind: String(candidate?.reference_kind || '').trim().toLowerCase() || null
    }))
    .filter(candidate => candidate.capa_code && candidate.retrieval_score !== null)
    .sort((a, b) => a.vector_rank - b.vector_rank);
}

function normalizeReferenceEvidence(value) {
  if (!Array.isArray(value)) return [];
  const seenReferenceIds = new Set();
  return value
    .slice(0, 50)
    .map((reference, index) => ({
      capa_code: normalizeCode(reference?.capa_code),
      retrieval_score: finite(reference?.retrieval_score),
      vector_rank: Number(reference?.vector_rank || index + 1) || index + 1,
      reference_id: Number(reference?.reference_id || 0) || null,
      reference_kind: String(reference?.reference_kind || '').trim().toLowerCase() || null
    }))
    .filter(reference => {
      if (!reference.capa_code || reference.retrieval_score === null || !reference.reference_id) return false;
      if (seenReferenceIds.has(reference.reference_id)) return false;
      seenReferenceIds.add(reference.reference_id);
      return true;
    })
    .sort((a, b) => a.vector_rank - b.vector_rank);
}

function clampLimit(value) {
  const parsed = Number(value || DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(parsed)));
}

export function normalizeObservabilityRow(row) {
  const evidence = parseEvidenceJson(row?.evidence_json);
  const retrieval = evidence?.retrieval || {};
  const geometric = evidence?.geometric || {};
  const production = evidence?.production || {};
  const retrievalCandidates = normalizeRetrievalCandidates(retrieval?.candidates);
  const referenceEvidence = normalizeReferenceEvidence(retrieval?.reference_evidence);

  const truth = normalizeCode(row?.confirmed_capa_code);
  const productionCode = normalizeCode(production?.capa_code);
  const retrievalCode = normalizeCode(row?.retrieval_capa_code || retrieval?.capa_code);
  const geometricCode = normalizeCode(row?.geometric_capa_code || geometric?.capa_code);
  const retrievalEligible = Number(row?.retrieval_fastpath_eligible || 0) === 1;
  const geometricEligible = Number(row?.geometric_eligible || 0) === 1;
  const contentIndependent = Number(row?.content_independent ?? 1) === 1;

  let verdict = 'pending';
  if (!contentIndependent) {
    verdict = 'excluded_non_independent';
  } else if (truth) {
    if (retrievalEligible) {
      verdict = retrievalCode === truth ? 'retrieval_correct' : 'retrieval_incorrect';
    } else if (geometricEligible) {
      verdict = geometricCode === truth ? 'geometric_incremental_correct' : 'geometric_incremental_incorrect';
    } else {
      verdict = 'no_safe_acceptance';
    }
  }

  const productionCorrect = truth && productionCode ? productionCode === truth : null;
  const geometricCorrect = truth && geometricCode ? geometricCode === truth : null;
  const wouldChangeProduction = Boolean(
    geometricEligible &&
    geometricCode &&
    productionCode &&
    geometricCode !== productionCode
  );
  const wouldFixProduction = Boolean(
    truth &&
    productionCode &&
    productionCode !== truth &&
    geometricEligible &&
    geometricCode === truth
  );
  const wouldWorsenProduction = Boolean(
    truth &&
    productionCode === truth &&
    geometricEligible &&
    geometricCode &&
    geometricCode !== truth
  );

  return {
    id: Number(row?.id || 0) || null,
    evidence_token: row?.evidence_token || null,
    photo_sha256: row?.photo_sha256 || null,
    platform: row?.platform || null,
    operator_name: row?.operator_name || null,
    occurrence_id: Number(row?.occurrence_id || 0) || null,
    shadow_version: row?.shadow_version || evidence?.shadow_version || null,
    gate_version: row?.gate_version || evidence?.gate_version || null,
    evidence_schema_version: evidence?.evidence_schema_version || null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
    confirmed_at: row?.confirmed_at || null,
    confirmation_source: row?.confirmation_source || null,
    confirmed_capa_code: truth,
    content_independent: contentIndependent,
    same_content_reference_count: Number(row?.same_content_reference_count || 0),
    production: {
      capa_code: productionCode,
      http_status: Number(production?.http_status || 0) || null,
      identified_by: production?.identified_by || null,
      correct: productionCorrect
    },
    retrieval: {
      eligible: retrievalEligible,
      capa_code: retrievalCode,
      top_score: finite(retrieval?.top_score),
      top2_code: normalizeCode(retrieval?.top2_code),
      top2_score: finite(retrieval?.top2_score),
      margin: finite(retrieval?.margin),
      reference_kind: retrieval?.reference_kind || null,
      candidate_count: Number(evidence?.candidate_count || retrievalCandidates.length) || retrievalCandidates.length,
      candidates: retrievalCandidates,
      reference_evidence_count: Number(retrieval?.reference_evidence_count || referenceEvidence.length) || referenceEvidence.length,
      reference_evidence: referenceEvidence
    },
    geometric: {
      evaluated: Number(row?.geometric_evaluated || 0) === 1,
      eligible: geometricEligible,
      capa_code: geometricCode,
      score: finite(geometric?.score),
      runner_up_code: normalizeCode(geometric?.runner_up_code),
      runner_up_score: finite(geometric?.runner_up_score),
      score_margin: finite(geometric?.score_margin),
      score_ratio: finite(geometric?.score_ratio),
      good_matches: Number(geometric?.good_matches || 0),
      inliers: Number(geometric?.inliers || 0),
      inlier_ratio: finite(geometric?.inlier_ratio),
      reference_coverage: finite(geometric?.reference_coverage),
      vector_rank: Number(geometric?.vector_rank || 0) || null,
      correct: geometricCorrect
    },
    processing_ms: Number(evidence?.processing_ms || 0) || null,
    verdict,
    would_change_production: wouldChangeProduction,
    would_fix_production: wouldFixProduction,
    would_worsen_production: wouldWorsenProduction
  };
}

async function loadCounts(env) {
  return env.DB.prepare(`
    SELECT
      COUNT(*) AS total_rows,
      SUM(CASE WHEN confirmed_capa_code IS NULL THEN 1 ELSE 0 END) AS pending_rows,
      SUM(CASE WHEN confirmed_capa_code IS NOT NULL THEN 1 ELSE 0 END) AS confirmed_rows
    FROM geometric_shadow_evidence
  `).first();
}

async function loadConfirmedRows(env) {
  const result = await env.DB.prepare(`
    SELECT
      id,evidence_token,photo_sha256,platform,retrieval_fastpath_eligible,retrieval_capa_code,
      geometric_evaluated,geometric_eligible,geometric_capa_code,content_independent,
      same_content_reference_count,confirmed_capa_code,confirmation_source,confirmed_at,created_at
    FROM geometric_shadow_evidence
    WHERE confirmed_capa_code IS NOT NULL
    ORDER BY id ASC
    LIMIT 5000
  `).all();
  return result?.results || [];
}

async function loadRecentRows(env, limit) {
  const result = await env.DB.prepare(`
    SELECT
      id,evidence_token,photo_sha256,platform,operator_name,occurrence_id,
      shadow_version,gate_version,retrieval_fastpath_eligible,retrieval_capa_code,
      geometric_evaluated,geometric_eligible,geometric_capa_code,content_independent,
      same_content_reference_count,evidence_json,confirmed_capa_code,confirmation_source,
      confirmed_at,created_at,updated_at
    FROM geometric_shadow_evidence
    ORDER BY id DESC
    LIMIT ?
  `).bind(limit).all();
  return result?.results || [];
}

export async function buildGeometricShadowObservability(env, { limit = DEFAULT_LIMIT } = {}) {
  if (!env?.DB) throw new Error('D1 não configurado.');
  const safeLimit = clampLimit(limit);
  const [counts, confirmed, recent] = await Promise.all([
    loadCounts(env),
    loadConfirmedRows(env),
    loadRecentRows(env, safeLimit)
  ]);

  const summary = summarizeGeometricShadowEvidence(confirmed, counts || {});
  const rows = recent.map(normalizeObservabilityRow);

  const diagnostics = {
    recent_rows: rows.length,
    recent_pending: rows.filter(row => row.verdict === 'pending').length,
    recent_non_independent: rows.filter(row => !row.content_independent).length,
    recent_geometric_evaluated: rows.filter(row => row.geometric.evaluated).length,
    recent_geometric_eligible: rows.filter(row => row.geometric.eligible).length,
    observed_would_fix_production: rows.filter(row => row.would_fix_production).length,
    observed_would_worsen_production: rows.filter(row => row.would_worsen_production).length
  };

  return {
    observability_version: 'v8.24',
    generated_at: new Date().toISOString(),
    production_changed: false,
    summary,
    diagnostics,
    rows
  };
}

async function getCachedGeometricShadowObservability(env, { limit = DEFAULT_LIMIT, forceFresh = false } = {}) {
  const safeLimit = clampLimit(limit);
  const now = Date.now();
  const cached = observabilityCacheByLimit.get(safeLimit);

  if (!forceFresh && cached?.report && cached.expiresAt > now) {
    return cached.report;
  }
  if (!forceFresh && cached?.promise) {
    return cached.promise;
  }

  const promise = buildGeometricShadowObservability(env, { limit: safeLimit });
  observabilityCacheByLimit.set(safeLimit, { promise, report: null, expiresAt: 0 });

  try {
    const report = await promise;
    observabilityCacheByLimit.set(safeLimit, {
      promise: null,
      report,
      expiresAt: Date.now() + OBSERVABILITY_CACHE_TTL_MS
    });
    return report;
  } catch (error) {
    observabilityCacheByLimit.delete(safeLimit);
    throw error;
  }
}

export async function handleGeometricShadowObservabilityRequest(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/api/admin/geometric-shadow-evidence/observability') {
    return null;
  }
  if (!env?.DB) return json({ error: 'D1 não configurado.' }, 503);

  try {
    const forceFresh = url.searchParams.get('fresh') === '1';
    const report = await getCachedGeometricShadowObservability(env, {
      limit: url.searchParams.get('limit'),
      forceFresh
    });
    return json({ ok: true, report });
  } catch (error) {
    return json({
      ok: false,
      error: 'Falha ao montar observabilidade geométrica.',
      technical_error: String(error?.message || error)
    }, 500);
  }
}
