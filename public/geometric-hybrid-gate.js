export const RETRIEVAL_GATE = Object.freeze({
  minScore: 0.920,
  minMargin: 0.008,
  allowedReferenceKinds: Object.freeze(['product', 'real_scan'])
});

export const GEOMETRIC_GATES = Object.freeze({
  observed_v815: Object.freeze({
    minGoodMatches: 8,
    minInliers: 6,
    minInlierRatio: 0.26,
    minCoverage: 0.02,
    minScoreMargin: 0,
    minScoreRatio: 1
  }),
  strict_core_v816: Object.freeze({
    minGoodMatches: 10,
    minInliers: 7,
    minInlierRatio: 0.28,
    minCoverage: 0.025,
    minScoreMargin: 1,
    minScoreRatio: 1.5
  })
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function byVectorRank(a, b) {
  return Number(a?.vector_rank || 999999) - Number(b?.vector_rank || 999999);
}

function byGeometricEvidence(a, b) {
  const scoreDelta = Number(b?.geometric_score || 0) - Number(a?.geometric_score || 0);
  if (scoreDelta) return scoreDelta;
  const inlierDelta = Number(b?.inliers || 0) - Number(a?.inliers || 0);
  if (inlierDelta) return inlierDelta;
  return byVectorRank(a, b);
}

export function evaluateRetrievalGate(result, gate = RETRIEVAL_GATE) {
  const candidates = [...(result?.candidates || [])].sort(byVectorRank);
  const top1 = candidates[0] || null;
  const top2 = candidates[1] || null;
  const topCode = normalizeCode(result?.vector_top1 || top1?.capa_code);
  const top1Code = normalizeCode(top1?.capa_code);
  const top2Code = normalizeCode(top2?.capa_code);
  const topScore = finite(result?.vector_top1_score ?? top1?.vector_score);
  const top2Score = finite(top2?.vector_score);
  const margin = topScore !== null && top2Score !== null ? topScore - top2Score : null;
  const referenceKind = String(top1?.reference_kind || '').trim().toLowerCase();
  const allowedKinds = new Set(gate.allowedReferenceKinds || RETRIEVAL_GATE.allowedReferenceKinds);

  const base = {
    eligible: false,
    capa_code: topCode || null,
    top_score: topScore,
    top2_score: top2Score,
    margin,
    reference_kind: referenceKind || null
  };

  if (!topCode || !top1Code || topCode !== top1Code) return { ...base, reason: 'top1_code_mismatch' };
  if (!top2Code || top2Code === topCode || candidates.length < 2) return { ...base, reason: 'retrieval_competitor_missing' };
  if (topScore === null || top2Score === null || margin === null) return { ...base, reason: 'retrieval_metrics_missing' };
  if (!allowedKinds.has(referenceKind)) return { ...base, reason: 'untrusted_reference_kind' };
  if (topScore < gate.minScore) return { ...base, reason: 'top1_score_below_fastpath' };
  if (margin < gate.minMargin || topScore <= top2Score) return { ...base, reason: 'top1_margin_below_fastpath' };
  return { ...base, eligible: true, reason: 'retrieval_score_margin_accept' };
}

export function passesAbsoluteGeometricGate(candidate, gate) {
  if (!candidate) return false;
  return Number(candidate.good_matches || 0) >= gate.minGoodMatches &&
    Number(candidate.inliers || 0) >= gate.minInliers &&
    Number(candidate.inlier_ratio || 0) >= gate.minInlierRatio &&
    Number(candidate.reference_coverage || 0) >= gate.minCoverage;
}

export function evaluateGeometricGate(result, gate = GEOMETRIC_GATES.observed_v815) {
  const candidates = [...(result?.candidates || [])].sort(byGeometricEvidence);
  const eligible = candidates.filter(candidate => passesAbsoluteGeometricGate(candidate, gate));
  const winner = eligible[0] || null;
  if (!winner) {
    return {
      eligible: false,
      capa_code: null,
      reason: 'geometric_absolute_gate_failed',
      score: null,
      runner_up_score: candidates[0] ? Number(candidates[0].geometric_score || 0) : null,
      score_margin: null,
      score_ratio: null
    };
  }

  const runnerUp = candidates.find(candidate => candidate !== winner) || null;
  const winnerScore = Number(winner.geometric_score || 0);
  const runnerUpScore = Number(runnerUp?.geometric_score || 0);
  const scoreMargin = winnerScore - runnerUpScore;
  const scoreRatio = runnerUpScore > 0 ? winnerScore / runnerUpScore : Infinity;
  const base = {
    eligible: false,
    capa_code: normalizeCode(winner.capa_code) || null,
    reason: null,
    score: winnerScore,
    runner_up_code: normalizeCode(runnerUp?.capa_code) || null,
    runner_up_score: runnerUpScore,
    score_margin: scoreMargin,
    score_ratio: scoreRatio,
    good_matches: Number(winner.good_matches || 0),
    inliers: Number(winner.inliers || 0),
    inlier_ratio: Number(winner.inlier_ratio || 0),
    reference_coverage: Number(winner.reference_coverage || 0),
    vector_rank: Number(winner.vector_rank || 0) || null,
    reference_kind: String(winner.reference_kind || '').trim().toLowerCase() || null
  };

  if (scoreMargin < gate.minScoreMargin) return { ...base, reason: 'geometric_margin_below_gate' };
  if (scoreRatio < gate.minScoreRatio) return { ...base, reason: 'geometric_ratio_below_gate' };
  return { ...base, eligible: true, reason: 'geometric_evidence_accept' };
}

export function simulateHybridDecision(result, geometricGate = GEOMETRIC_GATES.observed_v815, retrievalGate = RETRIEVAL_GATE) {
  const retrieval = evaluateRetrievalGate(result, retrievalGate);
  if (retrieval.eligible) {
    return {
      accepted: true,
      capa_code: retrieval.capa_code,
      accepted_by: 'retrieval-fastpath',
      retrieval,
      geometric: null
    };
  }

  const geometric = evaluateGeometricGate(result, geometricGate);
  if (geometric.eligible) {
    return {
      accepted: true,
      capa_code: geometric.capa_code,
      accepted_by: 'geometric-incremental',
      retrieval,
      geometric
    };
  }

  return {
    accepted: false,
    capa_code: null,
    accepted_by: null,
    retrieval,
    geometric
  };
}

function summarizeAccepted(results, decide) {
  const evaluated = (results || []).filter(item => item.status === 'evaluated');
  const decisions = evaluated.map(item => ({ item, decision: decide(item) }));
  const accepted = decisions.filter(entry => entry.decision.accepted);
  const correct = accepted.filter(entry => normalizeCode(entry.decision.capa_code) === normalizeCode(entry.item.ground_truth));
  const incorrect = accepted.length - correct.length;
  const incremental = accepted.filter(entry => entry.decision.accepted_by === 'geometric-incremental');
  const incrementalCorrect = incremental.filter(entry => normalizeCode(entry.decision.capa_code) === normalizeCode(entry.item.ground_truth));

  return {
    evaluated: evaluated.length,
    accepted: accepted.length,
    correct: correct.length,
    incorrect,
    precision: ratio(correct.length, accepted.length),
    coverage: ratio(accepted.length, evaluated.length),
    geometric_incremental: {
      accepted: incremental.length,
      correct: incrementalCorrect.length,
      incorrect: incremental.length - incrementalCorrect.length,
      precision: ratio(incrementalCorrect.length, incremental.length)
    }
  };
}

export function duplicateGroups(results) {
  const groups = new Map();
  for (const item of results || []) {
    if (item.status !== 'evaluated') continue;
    const hash = String(item.photo_sha256 || '').trim().toLowerCase();
    if (!hash) continue;
    if (!groups.has(hash)) groups.set(hash, []);
    groups.get(hash).push(item);
  }

  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([sha256, items]) => ({
      sha256,
      occurrence_ids: items.map(item => item.occurrence_id),
      platforms: [...new Set(items.map(item => item.platform))],
      ground_truths: [...new Set(items.map(item => normalizeCode(item.ground_truth)))],
      label_conflict: new Set(items.map(item => normalizeCode(item.ground_truth))).size > 1
    }));
}

export function dedupeExactImages(results) {
  const seen = new Set();
  const out = [];
  for (const item of results || []) {
    if (item.status !== 'evaluated') {
      out.push(item);
      continue;
    }
    const hash = String(item.photo_sha256 || '').trim().toLowerCase();
    if (!hash) {
      out.push(item);
      continue;
    }
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push(item);
  }
  return out;
}

export function summarizeHybridGates(results) {
  const retrieval = summarizeAccepted(results, item => {
    const decision = evaluateRetrievalGate(item);
    return {
      accepted: decision.eligible,
      capa_code: decision.eligible ? decision.capa_code : null,
      accepted_by: decision.eligible ? 'retrieval-fastpath' : null
    };
  });
  const observed = summarizeAccepted(results, item => simulateHybridDecision(item, GEOMETRIC_GATES.observed_v815));
  const strict = summarizeAccepted(results, item => simulateHybridDecision(item, GEOMETRIC_GATES.strict_core_v816));
  const duplicates = duplicateGroups(results);
  const deduped = dedupeExactImages(results);

  return {
    retrieval_fastpath: retrieval,
    hybrid_observed_v815: observed,
    hybrid_strict_core_v816: strict,
    exact_image_deduplication: {
      evaluated_before: (results || []).filter(item => item.status === 'evaluated').length,
      evaluated_after: deduped.filter(item => item.status === 'evaluated').length,
      duplicate_group_count: duplicates.length,
      duplicate_groups: duplicates,
      hybrid_observed_v815: summarizeAccepted(deduped, item => simulateHybridDecision(item, GEOMETRIC_GATES.observed_v815)),
      hybrid_strict_core_v816: summarizeAccepted(deduped, item => simulateHybridDecision(item, GEOMETRIC_GATES.strict_core_v816))
    },
    production_changed: false
  };
}
