import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSignedCandidates,
  validateReviewTicketPayloads,
  validateStoredCandidateSelection
} from '../src/ambiguous-review-router.js';

function validPayloads(overrides = {}) {
  const productionPayload = {
    platform: 'SHOPEE',
    codes: ['LIN2'],
    scores: { LIN2: 0.9422801 },
    performance: {
      retrieval_top1: 0.9422801,
      retrieval_margin: 0.00206874,
      cover_candidate_count: 10
    },
    ...(overrides.productionPayload || {})
  };
  const shadowPayload = {
    purpose: 'geometric-shadow-evidence-v818',
    nonce: 'shadow-123',
    platform: 'SHOPEE',
    candidates: [
      {
        capa_code: 'LIN2',
        retrieval_score: 0.9422801,
        vector_rank: 1,
        reference_id: 75,
        reference_kind: 'product'
      },
      {
        capa_code: 'LIN1',
        retrieval_score: 0.94021136,
        vector_rank: 2,
        reference_id: 1,
        reference_kind: 'product'
      }
    ],
    ...(overrides.shadowPayload || {})
  };
  return { productionPayload, shadowPayload };
}

test('v8.24.2 normalizes signed review candidates by rank and CAPA_CODE', () => {
  const candidates = normalizeSignedCandidates([
    { capa_code: 'lin1', retrieval_score: 0.90, vector_rank: 3, reference_id: 3 },
    { capa_code: 'LIN2', retrieval_score: 0.94, vector_rank: 1, reference_id: 1 },
    { capa_code: 'lin2', retrieval_score: 0.91, vector_rank: 2, reference_id: 2 },
    { capa_code: 'BAD', retrieval_score: 'nan', vector_rank: 4, reference_id: 4 }
  ]);

  assert.deepEqual(candidates.map(item => item.capa_code), ['LIN2', 'LIN1']);
  assert.equal(candidates[0].reference_id, 1);
  assert.equal(candidates[0].vector_rank, 1);
});

test('v8.24.2 accepts only a genuine signed Top-1 ambiguity context', () => {
  const { productionPayload, shadowPayload } = validPayloads();
  const result = validateReviewTicketPayloads({
    productionPayload,
    shadowPayload,
    platform: 'SHOPEE'
  });

  assert.equal(result.ok, true);
  assert.equal(result.top_code, 'LIN2');
  assert.equal(result.candidates.length, 2);
  assert.ok(result.margin < 0.005);
});

test('v8.24.2 rejects review when the production margin is not ambiguous', () => {
  const { productionPayload, shadowPayload } = validPayloads();
  productionPayload.performance.retrieval_margin = 0.008;

  const result = validateReviewTicketPayloads({
    productionPayload,
    shadowPayload,
    platform: 'SHOPEE'
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /não corresponde a uma ambiguidade/i);
});

test('v8.24.2 rejects ticket platform mismatch', () => {
  const { productionPayload, shadowPayload } = validPayloads();
  shadowPayload.platform = 'MERCADO LIVRE';

  const result = validateReviewTicketPayloads({
    productionPayload,
    shadowPayload,
    platform: 'SHOPEE'
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /Plataforma divergente/i);
});

test('v8.24.2 refuses an operator CAPA_CODE that was not persisted as a candidate', () => {
  const result = validateStoredCandidateSelection({
    occurrence: { id: 101, platform: 'SHOPEE', status: 'pending' },
    candidate: null,
    capaCode: 'SAF2'
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /não pertence às candidatas persistidas/i);
});

test('v8.24.2 accepts a persisted candidate for a pending occurrence', () => {
  const result = validateStoredCandidateSelection({
    occurrence: { id: 101, platform: 'SHOPEE', status: 'pending' },
    candidate: { occurrence_id: 101, capa_code: 'JAEN2' },
    capaCode: 'jaen2'
  });

  assert.deepEqual(result, {
    ok: true,
    capa_code: 'JAEN2',
    platform: 'SHOPEE'
  });
});
