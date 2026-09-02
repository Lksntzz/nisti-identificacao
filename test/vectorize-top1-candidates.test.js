import test from 'node:test';
import assert from 'node:assert/strict';
import { restrictTicketPayloadToTop1 } from '../src/vectorize-top1-candidates.js';

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
