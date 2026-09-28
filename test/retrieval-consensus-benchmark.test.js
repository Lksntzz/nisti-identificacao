import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateMultiReferenceMatches,
  evaluateMultiReferenceShadow,
  summarizeMultiReferenceShadow
} from '../src/retrieval-consensus-benchmark.js';

const env = {
  RETRIEVAL_FASTPATH_MIN_SCORE: '0.92',
  RETRIEVAL_FASTPATH_MIN_MARGIN: '0.008'
};

function match(score, referenceId, capaCode, kind, imageKey) {
  return {
    score,
    metadata: {
      reference_id: referenceId,
      capa_code: capaCode,
      reference_kind: kind,
      image_key: imageKey
    }
  };
}

test('Consensus Benchmark: excludes held-out self and keeps multiple distinct references per cover', () => {
  const sample = {
    reference_id: 99,
    image_key: 'occurrences/jade-self.jpg',
    trained_capa_code: 'JADE',
    platform: 'SHOPEE'
  };
  const matches = [
    match(0.999, 99, 'JADE', 'real_scan', 'occurrences/jade-self.jpg'),
    match(0.91, 10, 'JADE', 'product', 'products/jade.jpg'),
    match(0.90, 11, 'JADE', 'real_scan', 'occurrences/jade-other.jpg'),
    match(0.89, 12, 'BQE1', 'product', 'products/bqe1.jpg')
  ];

  const covers = aggregateMultiReferenceMatches(matches, sample);
  assert.equal(covers[0].capa_code, 'JADE');
  assert.equal(covers[0].support_count, 2);
  assert.deepEqual(covers[0].reference_kinds.sort(), ['product', 'real_scan']);
  assert.equal(covers[0].references.some(ref => ref.reference_id === 99), false);
});

test('Consensus Benchmark: detects two-reference rank consensus and diverse support without changing production gate', () => {
  const sample = {
    occurrence_id: 10,
    reference_id: 99,
    image_key: 'occurrences/jade-self.jpg',
    trained_capa_code: 'JADE',
    platform: 'SHOPEE'
  };
  const matches = [
    match(0.910, 10, 'JADE', 'product', 'products/jade.jpg'),
    match(0.905, 11, 'JADE', 'real_scan', 'occurrences/jade-other.jpg'),
    match(0.900, 12, 'BQE1', 'product', 'products/bqe1.jpg'),
    match(0.880, 13, 'JAEN2', 'product', 'products/jaen2.jpg')
  ];

  const result = evaluateMultiReferenceShadow(sample, matches, env);
  assert.equal(result.status, 'evaluated');
  assert.equal(result.top1_correct, true);
  assert.equal(result.current_fastpath_accepted, false);
  assert.equal(result.rank_consensus, true);
  assert.equal(result.diverse_rank_consensus, true);
  assert.equal(result.incremental_rank_consensus, true);
  assert.equal(result.incremental_diverse_rank_consensus, true);
});

test('Consensus Benchmark: summary exposes incremental precision and false positives separately', () => {
  const summary = summarizeMultiReferenceShadow([
    {
      status: 'evaluated',
      top1_correct: true,
      current_fastpath_accepted: true,
      rank_consensus: true,
      diverse_rank_consensus: true,
      incremental_rank_consensus: false,
      incremental_diverse_rank_consensus: false
    },
    {
      status: 'evaluated',
      top1_correct: true,
      current_fastpath_accepted: false,
      rank_consensus: true,
      diverse_rank_consensus: true,
      incremental_rank_consensus: true,
      incremental_diverse_rank_consensus: true
    },
    {
      status: 'evaluated',
      top1_correct: false,
      current_fastpath_accepted: false,
      rank_consensus: true,
      diverse_rank_consensus: false,
      incremental_rank_consensus: true,
      incremental_diverse_rank_consensus: false
    }
  ]);

  assert.equal(summary.current_fastpath.accepted, 1);
  assert.equal(summary.rank_consensus_shadow.accepted, 3);
  assert.equal(summary.rank_consensus_shadow.false_positives, 1);
  assert.equal(summary.incremental_rank_consensus.candidates, 2);
  assert.equal(summary.incremental_rank_consensus.false_positives, 1);
  assert.equal(summary.incremental_diverse_rank_consensus.candidates, 1);
  assert.equal(summary.incremental_diverse_rank_consensus.correct, 1);
  assert.equal(summary.production_changed, false);
});
