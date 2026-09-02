import { Buffer } from 'node:buffer';
import { normalizePlatform } from './platform-scope.js';

const SHADOW_PURPOSE = 'geometric-shadow-evidence-v818';
const SHADOW_VERSION = 'v8.18';
const GATE_VERSION = 'strict_core_v816';
const RETRIEVAL_MIN_SCORE = 0.920;
const RETRIEVAL_MIN_MARGIN = 0.008;
const ALLOWED_REFERENCE_KINDS = new Set(['product', 'real_scan']);
const ROLLOUT_MIN_UNIQUE_INCREMENTAL = 30;

const STRICT_GATE = Object.freeze({
  minGoodMatches: 10,
  minInliers: 7,
  minInlierRatio: 0.28,
  minCoverage: 0.025,
  minScoreMargin: 1,
  minScoreRatio: 1.5
});

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

function normalizeHash(value) {
  const hash = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

async function verifyShadowTicket(env, token) {
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
    if (payload?.purpose !== SHADOW_PURPOSE) return null;
    if (Number(payload?.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    if (!payload?.nonce || !normalizePlatform(payload?.platform)) return null;
    if (!Array.isArray(payload?.candidates) || !payload.candidates.length || payload.candidates.length > 10) return null;
    return payload;
  } catch {
    return null;
  }
}

function canonicalCandidates(payload) {
  return (payload?.candidates || [])
    .map((candidate, index) => ({
      capa_code: normalizeCode(candidate?.capa_code),
      retrieval_score: finite(candidate?.retrieval_score),
      vector_rank: Number(candidate?.vector_rank || index + 1),
      reference_id: Number(candidate?.reference_id || 0) || null,
      reference_kind: String(candidate?.reference_kind || '').trim().toLowerCase() || null
    }))
    .filter(candidate => candidate.capa_code && candidate.retrieval_score !== null)
    .sort((a, b) => a.vector_rank - b.vector_rank);
}

export function evaluateLiveRetrievalGate(candidates) {
  const ordered = [...(candidates || [])].sort((a, b) => Number(a.vector_rank || 999999) - Number(b.vector_rank || 999999));
  const top1 = ordered[0] || null;
  const top2 = ordered.find(item => item.capa_code !== top1?.capa_code) || null;
  const top1Score = finite(top1?.retrieval_score);
  const top2Score = finite(top2?.retrieval_score);
  const margin = top1Score !== null && top2Score !== null ? top1Score - top2Score : null;
  const referenceKind = String(top1?.reference_kind || '').trim().toLowerCase();

  const eligible = Boolean(
    top1?.capa_code &&
    top2?.capa_code &&
    top1Score !== null &&
    top2Score !== null &&
    ALLOWED_REFERENCE_KINDS.has(referenceKind) &&
    top1Score >= RETRIEVAL_MIN_SCORE &&
    margin !== null &&
    margin >= RETRIEVAL_MIN_MARGIN &&
    top1Score > top2Score
  );

  return {
    eligible,
    capa_code: top1?.capa_code || null,
    top_score: top1Score,
    top2_code: top2?.capa_code || null,
    top2_score: top2Score,
    margin,
    reference_kind: referenceKind || null
  };
}

export function evaluateLiveStrictGeometry(raw, allowedCodes = null) {
  const evaluated = raw?.geometric_evaluated === true;
  const capaCode = normalizeCode(raw?.geometric_capa_code);
  const allowed = allowedCodes instanceof Set ? allowedCodes : null;
  const score = finite(raw?.geometric_score);
  const runnerUpCode = normalizeCode(raw?.geometric_runner_up_code);
  const runnerUpScore = finite(raw?.geometric_runner_up_score) ?? 0;
  const goodMatches = Number(raw?.geometric_good_matches || 0);
  const inliers = Number(raw?.geometric_inliers || 0);
  const inlierRatio = finite(raw?.geometric_inlier_ratio) ?? 0;
  const coverage = finite(raw?.geometric_reference_coverage) ?? 0;
  const vectorRank = Number(raw?.geometric_vector_rank || 0) || null;
  const scoreMargin = score === null ? null : score - runnerUpScore;
  const scoreRatio = score === null
    ? null
    : runnerUpScore > 0 ? score / runnerUpScore : Infinity;

  const eligible = Boolean(
    evaluated &&
    capaCode &&
    (!allowed || allowed.has(capaCode)) &&
    score !== null &&
    goodMatches >= STRICT_GATE.minGoodMatches &&
    inliers >= STRICT_GATE.minInliers &&
    inlierRatio >= STRICT_GATE.minInlierRatio &&
    coverage >= STRICT_GATE.minCoverage &&
    scoreMargin >= STRICT_GATE.minScoreMargin &&
    scoreRatio >= STRICT_GATE.minScoreRatio
  );

  return {
    evaluated,
    eligible,
    capa_code: capaCode || null,
    score,
    runner_up_code: runnerUpCode || null,
    runner_up_score: runnerUpScore,
    score_margin: scoreMargin,
    score_ratio: Number.isFinite(scoreRatio) ? scoreRatio : null,
    good_matches: goodMatches,
    inliers,
    inlier_ratio: inlierRatio,
    reference_coverage: coverage,
    vector_rank: vectorRank
  };
}

function operatorContext(request) {
  let operatorName = null;
  const rawName = request.headers.get('x-operator-name');
  if (rawName) {
    try { operatorName = decodeURIComponent(rawName); } catch { operatorName = rawName; }
  }
  return {
    operator_name: operatorName,
    operator_id: request.headers.get('x-operator-id') || request.headers.get('x-user-id') || null
  };
}

export function normalizeLiveEvidence(body, signedPayload) {
  const platform = normalizePlatform(signedPayload?.platform);
  const photoSha256 = normalizeHash(body?.photo_sha256);
  const candidates = canonicalCandidates(signedPayload);
  const retrieval = evaluateLiveRetrievalGate(candidates);
  const allowedCodes = new Set(candidates.map(item => item.capa_code));
  const geometric = evaluateLiveStrictGeometry(body, allowedCodes);
  const occurrenceId = Number(body?.occurrence_id || 0) || null;

  if (!platform || !photoSha256 || !candidates.length) return null;

  return {
    evidence_token: String(signedPayload.nonce),
    photo_sha256: photoSha256,
    platform,
    occurrence_id: occurrenceId,
    retrieval,
    geometric,
    evidence_json: JSON.stringify({
      shadow_version: SHADOW_VERSION,
      gate_version: GATE_VERSION,
      production: {
        http_status: Number(body?.production_http_status || 0) || null,
        capa_code: normalizeCode(body?.production_capa_code) || null,
        identified_by: String(body?.production_identified_by || '').trim() || null
      },
      processing_ms: Number(body?.processing_ms || 0) || null,
      candidate_count: candidates.length,
      retrieval,
      geometric
    })
  };
}

async function saveEvidence(env, evidence, operator) {
  await env.DB.prepare(`
    INSERT INTO geometric_shadow_evidence (
      evidence_token,photo_sha256,platform,operator_id,operator_name,occurrence_id,
      shadow_version,gate_version,retrieval_fastpath_eligible,retrieval_capa_code,
      geometric_evaluated,geometric_eligible,geometric_capa_code,evidence_json,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(evidence_token) DO UPDATE SET
      photo_sha256=excluded.photo_sha256,
      platform=excluded.platform,
      operator_id=COALESCE(excluded.operator_id,geometric_shadow_evidence.operator_id),
      operator_name=COALESCE(excluded.operator_name,geometric_shadow_evidence.operator_name),
      occurrence_id=COALESCE(excluded.occurrence_id,geometric_shadow_evidence.occurrence_id),
      shadow_version=excluded.shadow_version,
      gate_version=excluded.gate_version,
      retrieval_fastpath_eligible=excluded.retrieval_fastpath_eligible,
      retrieval_capa_code=excluded.retrieval_capa_code,
      geometric_evaluated=excluded.geometric_evaluated,
      geometric_eligible=excluded.geometric_eligible,
      geometric_capa_code=excluded.geometric_capa_code,
      evidence_json=excluded.evidence_json,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    evidence.evidence_token,
    evidence.photo_sha256,
    evidence.platform,
    operator.operator_id,
    operator.operator_name,
    evidence.occurrence_id,
    SHADOW_VERSION,
    GATE_VERSION,
    evidence.retrieval.eligible ? 1 : 0,
    evidence.retrieval.capa_code,
    evidence.geometric.evaluated ? 1 : 0,
    evidence.geometric.eligible ? 1 : 0,
    evidence.geometric.capa_code,
    evidence.evidence_json
  ).run();
}

export async function linkGeometricShadowEvidenceToOccurrence(env, evidenceToken, occurrenceId) {
  const token = String(evidenceToken || '').trim();
  const id = Number(occurrenceId || 0);
  if (!token || !id || !env?.DB) return false;
  const result = await env.DB.prepare(`
    UPDATE geometric_shadow_evidence
    SET occurrence_id=?, updated_at=CURRENT_TIMESTAMP
    WHERE evidence_token=?
  `).bind(id, token).run();
  return Number(result?.meta?.changes || 0) > 0;
}

export async function confirmGeometricShadowEvidence(env, {
  occurrenceId = null,
  photoSha256 = null,
  capaCode,
  source = 'human_confirmed'
} = {}) {
  if (!env?.DB) return 0;
  const id = Number(occurrenceId || 0) || null;
  const hash = normalizeHash(photoSha256);
  const code = normalizeCode(capaCode);
  if (!code || (!id && !hash)) return 0;

  let result;
  if (id && hash) {
    result = await env.DB.prepare(`
      UPDATE geometric_shadow_evidence
      SET confirmed_capa_code=?, confirmation_source=?, confirmed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE occurrence_id=? OR photo_sha256=?
    `).bind(code, source, id, hash).run();
  } else if (id) {
    result = await env.DB.prepare(`
      UPDATE geometric_shadow_evidence
      SET confirmed_capa_code=?, confirmation_source=?, confirmed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE occurrence_id=?
    `).bind(code, source, id).run();
  } else {
    result = await env.DB.prepare(`
      UPDATE geometric_shadow_evidence
      SET confirmed_capa_code=?, confirmation_source=?, confirmed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE photo_sha256=?
    `).bind(code, source, hash).run();
  }
  return Number(result?.meta?.changes || 0);
}

function summarizeDecisionRows(rows) {
  let retrievalAccepted = 0;
  let retrievalCorrect = 0;
  let incrementalAccepted = 0;
  let incrementalCorrect = 0;
  let hybridAccepted = 0;
  let hybridCorrect = 0;

  for (const row of rows) {
    const truth = normalizeCode(row.confirmed_capa_code);
    const retrievalEligible = Number(row.retrieval_fastpath_eligible || 0) === 1;
    const geometricEligible = Number(row.geometric_eligible || 0) === 1;
    const retrievalCode = normalizeCode(row.retrieval_capa_code);
    const geometricCode = normalizeCode(row.geometric_capa_code);

    if (retrievalEligible) {
      retrievalAccepted += 1;
      if (retrievalCode === truth) retrievalCorrect += 1;
    }

    if (!retrievalEligible && geometricEligible) {
      incrementalAccepted += 1;
      if (geometricCode === truth) incrementalCorrect += 1;
    }

    const hybridCode = retrievalEligible ? retrievalCode : geometricEligible ? geometricCode : null;
    if (hybridCode) {
      hybridAccepted += 1;
      if (hybridCode === truth) hybridCorrect += 1;
    }
  }

  return {
    evaluated: rows.length,
    retrieval_fastpath: {
      accepted: retrievalAccepted,
      correct: retrievalCorrect,
      incorrect: retrievalAccepted - retrievalCorrect,
      precision: retrievalAccepted ? retrievalCorrect / retrievalAccepted : null
    },
    geometric_incremental: {
      accepted: incrementalAccepted,
      correct: incrementalCorrect,
      incorrect: incrementalAccepted - incrementalCorrect,
      precision: incrementalAccepted ? incrementalCorrect / incrementalAccepted : null
    },
    hybrid: {
      accepted: hybridAccepted,
      correct: hybridCorrect,
      incorrect: hybridAccepted - hybridCorrect,
      precision: hybridAccepted ? hybridCorrect / hybridAccepted : null,
      coverage: rows.length ? hybridAccepted / rows.length : null
    }
  };
}

export function summarizeGeometricShadowEvidence(rows, counts = {}) {
  const groups = new Map();
  for (const row of rows || []) {
    const hash = normalizeHash(row.photo_sha256);
    const platform = normalizePlatform(row.platform);
    const truth = normalizeCode(row.confirmed_capa_code);
    if (!hash || !platform || !truth) continue;
    const key = `${platform}:${hash}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const uniqueRows = [];
  const conflicts = [];
  for (const [key, items] of groups.entries()) {
    const labels = [...new Set(items.map(item => normalizeCode(item.confirmed_capa_code)).filter(Boolean))];
    if (labels.length !== 1) {
      conflicts.push({ key, labels, evidence_tokens: items.map(item => item.evidence_token) });
      continue;
    }
    uniqueRows.push(items[items.length - 1]);
  }

  const overall = summarizeDecisionRows(uniqueRows);
  const byPlatform = {};
  for (const platform of [...new Set(uniqueRows.map(row => normalizePlatform(row.platform)).filter(Boolean))]) {
    byPlatform[platform] = summarizeDecisionRows(uniqueRows.filter(row => normalizePlatform(row.platform) === platform));
  }

  const safeForPromotion =
    overall.geometric_incremental.accepted >= ROLLOUT_MIN_UNIQUE_INCREMENTAL &&
    overall.geometric_incremental.incorrect === 0 &&
    overall.hybrid.incorrect === 0 &&
    conflicts.length === 0;

  return {
    shadow_version: SHADOW_VERSION,
    gate_version: GATE_VERSION,
    total_rows: Number(counts.total_rows || 0),
    pending_rows: Number(counts.pending_rows || 0),
    confirmed_rows: Number(counts.confirmed_rows || rows?.length || 0),
    confirmed_unique: uniqueRows.length,
    duplicate_or_repeated_confirmed_rows: Math.max(0, Number(counts.confirmed_rows || rows?.length || 0) - uniqueRows.length),
    label_conflicts: conflicts,
    overall,
    by_platform: byPlatform,
    rollout_evidence: {
      min_unique_incremental_accepted: ROLLOUT_MIN_UNIQUE_INCREMENTAL,
      observed_unique_incremental_accepted: overall.geometric_incremental.accepted,
      observed_unique_incremental_correct: overall.geometric_incremental.correct,
      observed_unique_incremental_incorrect: overall.geometric_incremental.incorrect,
      observed_unique_hybrid_incorrect: overall.hybrid.incorrect,
      safe_for_promotion: safeForPromotion
    },
    production_changed: false
  };
}

async function summaryResponse(env) {
  const [counts, confirmed] = await Promise.all([
    env.DB.prepare(`
      SELECT
        COUNT(*) AS total_rows,
        SUM(CASE WHEN confirmed_capa_code IS NULL THEN 1 ELSE 0 END) AS pending_rows,
        SUM(CASE WHEN confirmed_capa_code IS NOT NULL THEN 1 ELSE 0 END) AS confirmed_rows
      FROM geometric_shadow_evidence
    `).first(),
    env.DB.prepare(`
      SELECT
        id,evidence_token,photo_sha256,platform,retrieval_fastpath_eligible,retrieval_capa_code,
        geometric_evaluated,geometric_eligible,geometric_capa_code,confirmed_capa_code,
        confirmation_source,confirmed_at,created_at
      FROM geometric_shadow_evidence
      WHERE confirmed_capa_code IS NOT NULL
      ORDER BY id ASC
      LIMIT 5000
    `).all()
  ]);

  return summarizeGeometricShadowEvidence(confirmed?.results || [], counts || {});
}

export async function handleGeometricShadowEvidenceRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/api/operator/geometric-shadow-evidence') {
    if (!env?.DB) return json({ error: 'D1 não configurado.' }, 503);
    const body = await request.json().catch(() => null);
    const signed = await verifyShadowTicket(env, body?.shadow_ticket);
    if (!signed) return json({ error: 'Shadow evidence ticket inválido ou expirado.' }, 401);
    const evidence = normalizeLiveEvidence(body, signed);
    if (!evidence) return json({ error: 'Evidência shadow inválida.' }, 400);
    await saveEvidence(env, evidence, operatorContext(request));
    return json({
      ok: true,
      evidence_token: evidence.evidence_token,
      retrieval_fastpath_eligible: evidence.retrieval.eligible,
      geometric_evaluated: evidence.geometric.evaluated,
      geometric_eligible: evidence.geometric.eligible,
      shadow_only: true,
      production_changed: false
    });
  }

  const linkMatch = url.pathname.match(/^\/api\/operator\/geometric-shadow-evidence\/([^/]+)\/link-occurrence$/);
  if (request.method === 'POST' && linkMatch) {
    const body = await request.json().catch(() => null);
    const signed = await verifyShadowTicket(env, body?.shadow_ticket);
    const token = decodeURIComponent(linkMatch[1]);
    if (!signed || String(signed.nonce) !== token) return json({ error: 'Shadow evidence ticket inválido.' }, 401);
    const linked = await linkGeometricShadowEvidenceToOccurrence(env, token, body?.occurrence_id);
    return linked
      ? json({ ok: true, linked: true, shadow_only: true })
      : json({ ok: false, linked: false, error: 'Evidência ainda não persistida.' }, 404);
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/geometric-shadow-evidence/summary') {
    if (!env?.DB) return json({ error: 'D1 não configurado.' }, 503);
    return json({ ok: true, summary: await summaryResponse(env) });
  }

  return null;
}
