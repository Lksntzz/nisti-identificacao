import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDistinctCoverRanking,
  evaluateRecallSample,
  summarizeRecallResults
} from '../src/retrieval-recall-benchmark.js';

test('Retrieval Recall Benchmark: excludes held-out self and ranks distinct CAPA_CODEs', () => {
  const sample = {
    occurrence_id: 50,
    reference_id: 99,
    image_key: 'occurrences/jdf3.jpg',
    trained_capa_code: 'JDF3',
    platform: 'SHOPEE'
  };
  const matches = [
    {
      score: 0.999,
      metadata: {
        reference_id: 99,
        image_key: 'occurrences/jdf3.jpg',
        capa_code: 'JDF3',
        reference_kind: 'real_scan'
      }
    },
    {
      score: 0.94,
      metadata: {
        reference_id: 1,
        image_key: 'products/jdf4.jpg',
        capa_code: 'JDF4',
        reference_kind: 'product'
      }
    },
    {
      score: 0.93,
      metadata: {
        reference_id: 2,
        image_key: 'occurrences/jdf4-2.jpg',
        capa_code: 'JDF4',
        reference_kind: 'real_scan'
      }
    },
    {
      score: 0.91,
      metadata: {
        reference_id: 3,
        image_key: 'products/jdf3.jpg',
        capa_code: 'JDF3',
        reference_kind: 'product'
      }
    }
  ];

  const ranking = buildDistinctCoverRanking(matches, sample);
  assert.equal(ranking.length, 2);
  assert.equal(ranking[0].capa_code, 'JDF4');
  assert.equal(ranking[0].cover_rank, 1);
  assert.equal(ranking[1].capa_code, 'JDF3');
  assert.equal(ranking[1].cover_rank, 2);
  assert.equal(ranking[1].vector_rank, 4);
});

test('Retrieval Recall Benchmark: exposes Recall@K hit position for the correct cover', () => {
  const sample = {
    occurrence_id: 51,
    reference_id: 99,
    image_key: 'occurrences/jdf3.jpg',
    trained_capa_code: 'JDF3',
    platform: 'SHOPEE'
  };
  const matches = [
    { score: 0.94, metadata: { reference_id: 1, image_key: 'a.jpg', capa_code: 'JDF4' } },
    { score: 0.93, metadata: { reference_id: 2, image_key: 'b.jpg', capa_code: 'JDF1' } },
    { score: 0.92, metadata: { reference_id: 3, image_key: 'c.jpg', capa_code: 'JDF3' } }
  ];

  const result = evaluateRecallSample(sample, matches);
  assert.equal(result.status, 'evaluated');
  assert.equal(result.correct_cover_rank, 3);
  assert.equal(result.recall_hits.at_1, false);
  assert.equal(result.recall_hits.at_3, true);
  assert.equal(result.recall_hits.at_5, true);
  assert.equal(result.missing_within_vector_top50, false);
});

test('Retrieval Recall Benchmark: summary reports Recall@K and misses within Vectorize Top-50', () => {
  const results = [
    {
      status: 'evaluated',
      platform: 'SHOPEE',
      ground_truth: 'A',
      missing_within_vector_top50: false,
      recall_hits: { at_1: true, at_3: true, at_5: true, at_10: true, at_20: true, at_50: true }
    },
    {
      status: 'evaluated',
      platform: 'SHOPEE',
      ground_truth: 'B',
      missing_within_vector_top50: false,
      recall_hits: { at_1: false, at_3: true, at_5: true, at_10: true, at_20: true, at_50: true }
    },
    {
      status: 'evaluated',
      platform: 'MERCADO LIVRE',
      ground_truth: 'C',
      missing_within_vector_top50: true,
      recall_hits: { at_1: false, at_3: false, at_5: false, at_10: false, at_20: false, at_50: false }
    }
  ];

  const summary = summarizeRecallResults(results);
  assert.equal(summary.evaluated, 3);
  assert.equal(summary.recall.at_1.hits, 1);
  assert.equal(summary.recall.at_1.rate, 1 / 3);
  assert.equal(summary.recall.at_3.hits, 2);
  assert.equal(summary.recall.at_3.rate, 2 / 3);
  assert.equal(summary.missing_within_vector_top50, 1);
  assert.equal(summary.by_platform.length, 2);
  assert.equal(summary.production_changed, false);
});
