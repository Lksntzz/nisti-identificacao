import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHeldOutResults } from '../src/retrieval-benchmark.js';

function acceptedCorrect(code, index) {
  return {
    status: 'evaluated',
    ground_truth: `${code}${index}`,
    top1_correct: true,
    fastpath_accepted: true,
    fastpath_correct: true,
    false_positive: false
  };
}

test('Retrieval Benchmark: 34 evaluated but only 12 accepted is not global-rollout evidence', () => {
  const results = [];
  for (let i = 0; i < 12; i += 1) results.push(acceptedCorrect('A', i));
  for (let i = 0; i < 22; i += 1) {
    results.push({
      status: 'evaluated',
      ground_truth: `R${i}`,
      top1_correct: i % 2 === 0,
      fastpath_accepted: false,
      fastpath_correct: false,
      false_positive: false
    });
  }

  const summary = summarizeHeldOutResults(results);
  assert.equal(summary.evaluated, 34);
  assert.equal(summary.fastpath_accepted, 12);
  assert.equal(summary.false_positives, 0);
  assert.equal(summary.safe_for_global_rollout, false);
});

test('Retrieval Benchmark: requires at least 30 accepted samples and zero false positives', () => {
  const results = Array.from({ length: 30 }, (_, index) => acceptedCorrect('C', index));
  const summary = summarizeHeldOutResults(results);

  assert.equal(summary.fastpath_accepted, 30);
  assert.equal(summary.fastpath_precision, 1);
  assert.equal(summary.false_positives, 0);
  assert.equal(summary.safe_for_global_rollout, true);
});
