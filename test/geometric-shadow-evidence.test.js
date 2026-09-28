import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateLiveRetrievalGate,
  evaluateLiveStrictGeometry,
  normalizeLiveEvidence,
  summarizeGeometricShadowEvidence
} from '../src/geometric-shadow-evidence-router.js';

function signedPayload() {
  return {
    purpose: 'geometric-shadow-evidence-v818',
    exp: 9999999999,
    nonce: 'token-1',
    platform: 'SHOPEE',
    candidates: [
      { capa_code: 'A', retrieval_score: 0.921, vector_rank: 1, reference_id: 1, reference_kind: 'product' },
      { capa_code: 'B', retrieval_score: 0.918, vector_rank: 2, reference_id: 2, reference_kind: 'product' },
      { capa_code: 'C', retrieval_score: 0.85, vector_rank: 3, reference_id: 3, reference_kind: 'real_scan' }
    ],
    reference_evidence: [
      { capa_code: 'A', retrieval_score: 0.921, vector_rank: 1, reference_id: 1, reference_kind: 'product' },
      { capa_code: 'A', retrieval_score: 0.919, vector_rank: 2, reference_id: 11, reference_kind: 'real_scan' },
      { capa_code: 'B', retrieval_score: 0.918, vector_rank: 3, reference_id: 2, reference_kind: 'product' }
    ]
  };
}

test('Live shadow: server recomputes retrieval fastpath from signed candidates', () => {
  const rejected = evaluateLiveRetrievalGate(signedPayload().candidates);
  assert.equal(rejected.eligible, false);
  assert.equal(rejected.capa_code, 'A');
  assert.ok(rejected.margin < 0.008);

  const accepted = evaluateLiveRetrievalGate([
    { capa_code: 'A', retrieval_score: 0.94, vector_rank: 1, reference_kind: 'real_scan' },
    { capa_code: 'B', retrieval_score: 0.90, vector_rank: 2, reference_kind: 'product' }
  ]);
  assert.equal(accepted.eligible, true);
  assert.equal(accepted.capa_code, 'A');
});

test('Live shadow: strict geometry must pass absolute and separation gates', () => {
  const allowed = new Set(['A', 'B']);
  const accepted = evaluateLiveStrictGeometry({
    geometric_evaluated: true,
    geometric_capa_code: 'B',
    geometric_score: 4.1,
    geometric_runner_up_code: 'A',
    geometric_runner_up_score: 0.5,
    geometric_good_matches: 10,
    geometric_inliers: 8,
    geometric_inlier_ratio: 0.8,
    geometric_reference_coverage: 0.035,
    geometric_vector_rank: 2
  }, allowed);
  assert.equal(accepted.eligible, true);
  assert.equal(accepted.capa_code, 'B');

  const borderline = evaluateLiveStrictGeometry({
    geometric_evaluated: true,
    geometric_capa_code: 'B',
    geometric_score: 2.5,
    geometric_runner_up_score: 0.6,
    geometric_good_matches: 9,
    geometric_inliers: 6,
    geometric_inlier_ratio: 0.66,
    geometric_reference_coverage: 0.033
  }, allowed);
  assert.equal(borderline.eligible, false);

  const forgedCode = evaluateLiveStrictGeometry({
    geometric_evaluated: true,
    geometric_capa_code: 'Z',
    geometric_score: 100,
    geometric_runner_up_score: 0,
    geometric_good_matches: 100,
    geometric_inliers: 100,
    geometric_inlier_ratio: 1,
    geometric_reference_coverage: 1
  }, allowed);
  assert.equal(forgedCode.eligible, false);
});

test('Live shadow: normalization keeps production decision informational and shadow-only', () => {
  const normalized = normalizeLiveEvidence({
    photo_sha256: 'a'.repeat(64),
    production_http_status: 200,
    production_capa_code: 'A',
    production_identified_by: 'retrieval-score-margin-fastpath',
    content_independent: true,
    same_content_reference_count: 0,
    reference_load_error_count: 0,
    geometric_evaluated: false
  }, signedPayload());

  assert.equal(normalized.platform, 'SHOPEE');
  assert.equal(normalized.photo_sha256, 'a'.repeat(64));
  assert.equal(normalized.content_independent, true);
  assert.equal(normalized.retrieval.eligible, false);
  assert.equal(normalized.geometric.eligible, false);
  const detail = JSON.parse(normalized.evidence_json);
  assert.equal(detail.production.capa_code, 'A');
  assert.equal(detail.shadow_version, 'v8.18');
  assert.equal(detail.evidence_schema_version, 'v8.24');
  assert.deepEqual(detail.retrieval.candidates.map(candidate => candidate.capa_code), ['A', 'B', 'C']);
  assert.deepEqual(detail.retrieval.candidates.map(candidate => candidate.vector_rank), [1, 2, 3]);
  assert.equal(detail.retrieval.candidates[2].reference_id, 3);
  assert.equal(detail.retrieval.candidates[2].reference_kind, 'real_scan');
  assert.equal(detail.retrieval.reference_evidence_count, 3);
  assert.deepEqual(detail.retrieval.reference_evidence.slice(0, 2).map(reference => reference.capa_code), ['A', 'A']);
  assert.equal(detail.retrieval.reference_evidence[1].reference_kind, 'real_scan');
});

test('Live shadow: same-content reference makes geometric evidence fail closed', () => {
  const normalized = normalizeLiveEvidence({
    photo_sha256: 'b'.repeat(64),
    content_independent: false,
    same_content_reference_count: 1,
    reference_load_error_count: 0,
    geometric_evaluated: true,
    geometric_capa_code: 'B',
    geometric_score: 20,
    geometric_runner_up_score: 0,
    geometric_good_matches: 30,
    geometric_inliers: 25,
    geometric_inlier_ratio: 0.83,
    geometric_reference_coverage: 0.4
  }, signedPayload());

  assert.equal(normalized.content_independent, false);
  assert.equal(normalized.same_content_reference_count, 1);
  assert.equal(normalized.geometric.eligible, false);
});

test('Live shadow: rollout evidence dedupes exact photos and stays blocked below 30 incrementals', () => {
  const row = (id, hash, truth, geometricCode = truth) => ({
    id,
    evidence_token: `t${id}`,
    photo_sha256: hash,
    platform: id % 2 ? 'SHOPEE' : 'MERCADO LIVRE',
    content_independent: 1,
    retrieval_fastpath_eligible: 0,
    retrieval_capa_code: 'WRONG',
    geometric_evaluated: 1,
    geometric_eligible: 1,
    geometric_capa_code: geometricCode,
    confirmed_capa_code: truth,
    confirmed_at: '2026-09-02 20:00:00'
  });

  const rows = [
    row(1, '1'.repeat(64), 'A'),
    row(2, '2'.repeat(64), 'B'),
    row(3, '1'.repeat(64), 'A')
  ];
  const summary = summarizeGeometricShadowEvidence(rows, {
    total_rows: 3,
    pending_rows: 0,
    confirmed_rows: 3
  });

  assert.equal(summary.confirmed_unique, 2);
  assert.equal(summary.overall.geometric_incremental.accepted, 2);
  assert.equal(summary.overall.geometric_incremental.correct, 2);
  assert.equal(summary.rollout_evidence.safe_for_promotion, false);
});

test('Live shadow: non-independent confirmed rows are excluded from rollout evidence', () => {
  const summary = summarizeGeometricShadowEvidence([{
    id: 1,
    evidence_token: 'leak-1',
    photo_sha256: 'e'.repeat(64),
    platform: 'SHOPEE',
    content_independent: 0,
    retrieval_fastpath_eligible: 0,
    geometric_evaluated: 1,
    geometric_eligible: 1,
    geometric_capa_code: 'A',
    confirmed_capa_code: 'A'
  }], { total_rows: 1, pending_rows: 0, confirmed_rows: 1 });

  assert.equal(summary.excluded_non_independent_confirmed_rows, 1);
  assert.equal(summary.confirmed_unique, 0);
  assert.equal(summary.overall.geometric_incremental.accepted, 0);
});

test('Live shadow: a confirmed wrong geometric decision is counted as a false positive', () => {
  const summary = summarizeGeometricShadowEvidence([{
    id: 1,
    evidence_token: 'bad-1',
    photo_sha256: 'f'.repeat(64),
    platform: 'SHOPEE',
    content_independent: 1,
    retrieval_fastpath_eligible: 0,
    retrieval_capa_code: 'A',
    geometric_evaluated: 1,
    geometric_eligible: 1,
    geometric_capa_code: 'B',
    confirmed_capa_code: 'C'
  }], { total_rows: 1, pending_rows: 0, confirmed_rows: 1 });

  assert.equal(summary.overall.geometric_incremental.accepted, 1);
  assert.equal(summary.overall.geometric_incremental.correct, 0);
  assert.equal(summary.overall.geometric_incremental.incorrect, 1);
  assert.equal(summary.rollout_evidence.safe_for_promotion, false);
});
