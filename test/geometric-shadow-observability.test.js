import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObservabilityRow } from '../src/geometric-shadow-observability-router.js';

function row(overrides = {}) {
  return {
    id: 1,
    evidence_token: 'tok',
    photo_sha256: 'a'.repeat(64),
    platform: 'MERCADO LIVRE',
    operator_name: 'Teste',
    occurrence_id: 10,
    shadow_version: 'v8.18',
    gate_version: 'strict_core_v816',
    retrieval_fastpath_eligible: 0,
    retrieval_capa_code: 'LTE2',
    geometric_evaluated: 1,
    geometric_eligible: 1,
    geometric_capa_code: 'LTE1',
    content_independent: 1,
    same_content_reference_count: 0,
    confirmed_capa_code: 'LTE1',
    confirmation_source: 'operator_confirmed_production_result',
    confirmed_at: '2026-09-02 23:00:00',
    created_at: '2026-09-02 22:59:00',
    updated_at: '2026-09-02 23:00:00',
    evidence_json: JSON.stringify({
      production: { http_status: 200, capa_code: 'LTE2', identified_by: 'fallback' },
      processing_ms: 742,
      retrieval: {
        eligible: false,
        capa_code: 'LTE2',
        top_score: 0.9214,
        top2_code: 'LTE1',
        top2_score: 0.9181,
        margin: 0.0033,
        reference_kind: 'product'
      },
      geometric: {
        evaluated: true,
        eligible: true,
        capa_code: 'LTE1',
        score: 4.05,
        runner_up_code: 'LTE2',
        runner_up_score: 1.2,
        score_margin: 2.85,
        score_ratio: 3.375,
        good_matches: 10,
        inliers: 8,
        inlier_ratio: 0.8,
        reference_coverage: 0.034,
        vector_rank: 2
      }
    }),
    ...overrides
  };
}

test('v8.20 observability marks a strict geometric recovery that would fix production', () => {
  const normalized = normalizeObservabilityRow(row());
  assert.equal(normalized.verdict, 'geometric_incremental_correct');
  assert.equal(normalized.would_change_production, true);
  assert.equal(normalized.would_fix_production, true);
  assert.equal(normalized.would_worsen_production, false);
  assert.equal(normalized.geometric.capa_code, 'LTE1');
  assert.equal(normalized.retrieval.margin, 0.0033);
});

test('v8.20 observability marks a geometric false positive that would worsen a correct production result', () => {
  const normalized = normalizeObservabilityRow(row({
    confirmed_capa_code: 'LTE2',
    evidence_json: JSON.stringify({
      production: { http_status: 200, capa_code: 'LTE2', identified_by: 'fallback' },
      retrieval: { eligible: false, capa_code: 'LTE2', top_score: 0.91, top2_code: 'LTE1', top2_score: 0.905, margin: 0.005 },
      geometric: { evaluated: true, eligible: true, capa_code: 'LTE1', score: 5, runner_up_code: 'LTE2', runner_up_score: 2, good_matches: 12, inliers: 9, inlier_ratio: 0.75, reference_coverage: 0.04, vector_rank: 2 }
    })
  }));

  assert.equal(normalized.verdict, 'geometric_incremental_incorrect');
  assert.equal(normalized.would_fix_production, false);
  assert.equal(normalized.would_worsen_production, true);
});

test('v8.20 observability keeps pending evidence out of correctness claims', () => {
  const normalized = normalizeObservabilityRow(row({ confirmed_capa_code: null }));
  assert.equal(normalized.verdict, 'pending');
  assert.equal(normalized.production.correct, null);
  assert.equal(normalized.geometric.correct, null);
});

test('v8.20 observability visibly excludes non-independent evidence', () => {
  const normalized = normalizeObservabilityRow(row({ content_independent: 0, same_content_reference_count: 1 }));
  assert.equal(normalized.verdict, 'excluded_non_independent');
  assert.equal(normalized.content_independent, false);
  assert.equal(normalized.same_content_reference_count, 1);
});
