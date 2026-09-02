import test from 'node:test';
import assert from 'node:assert/strict';
import {
  restrictTicketPayloadToTop1,
  buildShadowEvidencePayload
} from '../src/vectorize-top1-candidates.js';

test('Top-1 verifier ticket keeps only the highest-ranked CAPA_CODE', () => {
  const payload = {
    exp: 123456,
    nonce: 'nonce-1',
    platform: 'SHOPEE',
    codes: ['JADE', 'BQE1', 'JAEN2', 'JAEN1'],
    scores: {
      JADE: 0.9257,
      BQE1: 0.9138,
      JAEN2: 0.90,
      JAEN1: 0.89
    },
    references: [
      { reference_id: 1, capa_code: 'JADE', retrieval_score: 0.9257 },
      { reference_id: 2, capa_code: 'BQE1', retrieval_score: 0.9138 },
      { reference_id: 3, capa_code: 'JAEN2', retrieval_score: 0.90 },
      { reference_id: 4, capa_code: 'JAEN1', retrieval_score: 0.89 }
    ],
    performance: {
      retrieval_top1: 0.9257,
      retrieval_top1_code: 'JADE',
      retrieval_top2: 0.9138,
      retrieval_top2_code: 'BQE1',
      retrieval_margin: 0.0119,
      cover_candidate_count: 4
    }
  };

  const restricted = restrictTicketPayloadToTop1(payload);

  assert.deepEqual(restricted.codes, ['JADE']);
  assert.deepEqual(restricted.scores, { JADE: 0.9257 });
  assert.equal(restricted.references.length, 1);
  assert.equal(restricted.references[0].capa_code, 'JADE');
  assert.equal(restricted.performance.retrieval_top2_code, 'BQE1');
  assert.equal(restricted.performance.cover_candidate_count, 4);

  // The wide-recall source payload remains intact for telemetry/debugging.
  assert.equal(payload.codes.length, 4);
  assert.equal(payload.references.length, 4);
});

test('Top-1 verifier ticket rejects an empty candidate list', () => {
  assert.equal(restrictTicketPayloadToTop1({ codes: [], scores: {}, references: [] }), null);
  assert.equal(restrictTicketPayloadToTop1(null), null);
});

test('v8.18 shadow payload carries Top-10 evidence without changing the production Top-1 ticket', () => {
  const sourcePayload = {
    platform: 'SHOPEE',
    codes: Array.from({ length: 10 }, (_, index) => `C${index + 1}`),
    scores: {}
  };
  const candidates = Array.from({ length: 10 }, (_, index) => ({
    capa_code: `C${index + 1}`,
    vector_rank: index + 1,
    retrieval_score: 0.95 - index * 0.01,
    reference_id: index + 1,
    reference_kind: index === 0 ? 'real_scan' : 'product',
    image_key: `products/c${index + 1}.jpg`
  }));

  const shadow = buildShadowEvidencePayload(sourcePayload, candidates, {
    nowSeconds: 1000,
    nonce: 'shadow-token-1'
  });
  const production = restrictTicketPayloadToTop1({
    ...sourcePayload,
    references: candidates
  });

  assert.equal(shadow.token, 'shadow-token-1');
  assert.equal(shadow.signed_payload.purpose, 'geometric-shadow-evidence-v818');
  assert.equal(shadow.signed_payload.exp, 1900);
  assert.equal(shadow.candidates.length, 10);
  assert.equal(shadow.candidates[0].capa_code, 'C1');
  assert.match(shadow.candidates[0].image_url, /^\/api\/reference-images\/1\?v=/);
  assert.deepEqual(production.codes, ['C1']);
  assert.equal(production.references.length, 1);
});
