import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateHeldOutMatches,
  evaluateHeldOutSample,
  summarizeHeldOutResults
} from '../src/retrieval-benchmark.js';

const env = {
  RETRIEVAL_FASTPATH_MIN_SCORE: '0.92',
  RETRIEVAL_FASTPATH_MIN_MARGIN: '0.008'
};

test('Retrieval Benchmark: excludes the trained sample itself before ranking', () => {
  const sample = {
    occurrence_id: 10,
    image_key: 'occurrences/jade.jpg',
    reference_id: 99,
    trained_capa_code: 'JADE',
    platform: 'SHOPEE'
  };

  const matches = [
    {
      id: 'self',
      score: 0.999,
      metadata: {
        reference_id: 99,
        image_key: 'occurrences/jade.jpg',
        capa_code: 'JADE',
        reference_kind: 'real_scan'
      }
    },
    {
      id: 'jade-other',
      score: 0.931,
      metadata: {
        reference_id: 11,
        image_key: 'products/jade.jpg',
        capa_code: 'JADE',
        reference_kind: 'product'
      }
    },
    {
      id: 'bqe1',
      score: 0.91,
      metadata: {
        reference_id: 12,
        image_key: 'products/bqe1.jpg',
        capa_code: 'BQE1',
        reference_kind: 'product'
      }
    }
  ];

  const covers = aggregateHeldOutMatches(matches, sample);
  assert.equal(covers.length, 2);
  assert.equal(covers[0].capa_code, 'JADE');
  assert.equal(covers[0].reference_id, 11);
  assert.equal(covers[0].retrieval_score, 0.931);
});

test('Retrieval Benchmark: applies the same production fast-path gate', () => {
  const sample = {
    occurrence_id: 10,
    image_key: 'occurrences/jade.jpg',
    reference_id: 99,
    trained_capa_code: 'JADE',
    platform: 'SHOPEE'
  };
  const matches = [
    {
      score: 0.929,
      metadata: {
        reference_id: 11,
        image_key: 'products/jade.jpg',
        capa_code: 'JADE',
        reference_kind: 'product'
      }
    },
    {
      score: 0.912,
      metadata: {
        reference_id: 12,
        image_key: 'products/bqe1.jpg',
        capa_code: 'BQE1',
        reference_kind: 'product'
      }
    }
  ];

  const result = evaluateHeldOutSample(sample, matches, env);
  assert.equal(result.status, 'evaluated');
  assert.equal(result.top1_correct, true);
  assert.equal(result.fastpath_accepted, true);
  assert.equal(result.fastpath_correct, true);
  assert.equal(result.false_positive, false);
});

test('Retrieval Benchmark: summary exposes false positives and rollout safety', () => {
  const summary = summarizeHeldOutResults([
    {
      status: 'evaluated',
      ground_truth: 'JADE',
      top1_correct: true,
      fastpath_accepted: true,
      fastpath_correct: true,
      false_positive: false
    },
    {
      status: 'evaluated',
      ground_truth: 'JAEN1',
      top1_correct: false,
      fastpath_accepted: true,
      fastpath_correct: false,
      false_positive: true
    },
    {
      status: 'skipped',
      reason: 'platform_invalid'
    }
  ]);

  assert.equal(summary.evaluated, 2);
  assert.equal(summary.fastpath_accepted, 2);
  assert.equal(summary.false_positives, 1);
  assert.equal(summary.fastpath_precision, 0.5);
  assert.equal(summary.safe_for_global_rollout, false);
});
