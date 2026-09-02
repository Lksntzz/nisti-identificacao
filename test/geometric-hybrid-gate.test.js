import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateRetrievalGate,
  evaluateGeometricGate,
  simulateHybridDecision,
  summarizeHybridGates,
  duplicateGroups,
  GEOMETRIC_GATES
} from '../public/geometric-hybrid-gate.js';

function candidate({
  code,
  vectorRank,
  vectorScore,
  kind = 'product',
  geometricScore = 0,
  good = 0,
  inliers = 0,
  ratio = 0,
  coverage = 0
}) {
  return {
    capa_code: code,
    vector_rank: vectorRank,
    vector_score: vectorScore,
    reference_kind: kind,
    geometric_score: geometricScore,
    good_matches: good,
    inliers,
    inlier_ratio: ratio,
    reference_coverage: coverage
  };
}

function result(overrides = {}) {
  return {
    status: 'evaluated',
    occurrence_id: 1,
    platform: 'SHOPEE',
    ground_truth: 'A',
    vector_top1: 'A',
    vector_top1_score: 0.94,
    candidates: [
      candidate({ code: 'A', vectorRank: 1, vectorScore: 0.94, geometricScore: 0, good: 1 }),
      candidate({ code: 'B', vectorRank: 2, vectorScore: 0.90, geometricScore: 8, good: 14, inliers: 11, ratio: 0.78, coverage: 0.12 })
    ],
    ...overrides
  };
}

test('Hybrid Gate: production retrieval fastpath keeps precedence over conflicting geometry', () => {
  const sample = result();
  const retrieval = evaluateRetrievalGate(sample);
  assert.equal(retrieval.eligible, true);

  const geometric = evaluateGeometricGate(sample, GEOMETRIC_GATES.observed_v815);
  assert.equal(geometric.eligible, true);
  assert.equal(geometric.capa_code, 'B');

  const hybrid = simulateHybridDecision(sample, GEOMETRIC_GATES.observed_v815);
  assert.equal(hybrid.accepted, true);
  assert.equal(hybrid.capa_code, 'A');
  assert.equal(hybrid.accepted_by, 'retrieval-fastpath');
});

test('Hybrid Gate: strong geometry rescues a fastpath-rejected candidate', () => {
  const sample = result({
    ground_truth: 'B',
    vector_top1: 'A',
    vector_top1_score: 0.91,
    candidates: [
      candidate({ code: 'A', vectorRank: 1, vectorScore: 0.91, geometricScore: 0, good: 2 }),
      candidate({ code: 'B', vectorRank: 2, vectorScore: 0.89, geometricScore: 4.2, good: 10, inliers: 8, ratio: 0.8, coverage: 0.04 })
    ]
  });

  assert.equal(evaluateRetrievalGate(sample).eligible, false);
  const hybrid = simulateHybridDecision(sample, GEOMETRIC_GATES.observed_v815);
  assert.equal(hybrid.accepted, true);
  assert.equal(hybrid.capa_code, 'B');
  assert.equal(hybrid.accepted_by, 'geometric-incremental');
});

test('Hybrid Gate: invalid geometric ranking cannot create an incremental acceptance', () => {
  const sample = result({
    ground_truth: 'B',
    vector_top1: 'A',
    vector_top1_score: 0.89,
    candidates: [
      candidate({ code: 'A', vectorRank: 1, vectorScore: 0.89, geometricScore: 0 }),
      candidate({ code: 'B', vectorRank: 2, vectorScore: 0.87, geometricScore: 0.6, good: 4, inliers: 4, ratio: 1, coverage: 0.3 })
    ]
  });

  const hybrid = simulateHybridDecision(sample, GEOMETRIC_GATES.observed_v815);
  assert.equal(hybrid.accepted, false);
  assert.equal(hybrid.capa_code, null);
});

test('Hybrid Gate: strict calibration rejects a borderline 9-match 6-inlier case', () => {
  const sample = result({
    vector_top1: 'A',
    vector_top1_score: 0.76,
    candidates: [
      candidate({ code: 'A', vectorRank: 1, vectorScore: 0.76, geometricScore: 0 }),
      candidate({ code: 'B', vectorRank: 2, vectorScore: 0.74, geometricScore: 2.5, good: 9, inliers: 6, ratio: 2 / 3, coverage: 0.033 })
    ]
  });

  assert.equal(evaluateGeometricGate(sample, GEOMETRIC_GATES.observed_v815).eligible, true);
  assert.equal(evaluateGeometricGate(sample, GEOMETRIC_GATES.strict_core_v816).eligible, false);
});

test('Hybrid Gate: exact image duplicates are grouped and deduplicated for evidence reporting', () => {
  const first = result({ occurrence_id: 17, photo_sha256: 'abc', ground_truth: 'A' });
  const second = result({ occurrence_id: 18, photo_sha256: 'abc', ground_truth: 'A' });
  const third = result({ occurrence_id: 19, photo_sha256: 'def', ground_truth: 'A' });
  const groups = duplicateGroups([first, second, third]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].occurrence_ids, [17, 18]);
  assert.equal(groups[0].label_conflict, false);

  const summary = summarizeHybridGates([first, second, third]);
  assert.equal(summary.exact_image_deduplication.evaluated_before, 3);
  assert.equal(summary.exact_image_deduplication.evaluated_after, 2);
  assert.equal(summary.production_changed, false);
});
