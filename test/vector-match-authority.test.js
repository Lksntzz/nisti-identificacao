import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeActiveVectorMatches } from '../src/vector-match-authority.js';
import { rebuildPayloadFromAuthoritativeMatches } from '../src/vectorize-top1-candidates.js';

function dbWith(rows) {
  return {
    prepare() {
      return {
        bind(...ids) {
          return {
            async all() {
              const wanted = new Set(ids.map(Number));
              return { results: rows.filter(row => wanted.has(Number(row.id))) };
            }
          };
        }
      };
    }
  };
}

test('Vector authority drops orphan vectors and replaces stale metadata from D1', async () => {
  const env = {
    DB: dbWith([
      {
        id: 2,
        capa_code: 'BQE1',
        image_key: 'products/bqe1.jpg',
        source_product_id: 20,
        reference_kind: 'product',
        active: 1
      }
    ])
  };

  const matches = [
    {
      id: 'orphan',
      score: 0.95,
      metadata: {
        reference_id: 999,
        capa_code: 'JAEN1',
        image_key: 'old/auto.jpg',
        reference_kind: 'auto_learned'
      }
    },
    {
      id: 'valid',
      score: 0.94,
      metadata: {
        reference_id: 2,
        capa_code: 'WRONG',
        image_key: 'stale.jpg',
        reference_kind: 'auto_learned'
      }
    }
  ];

  const result = await canonicalizeActiveVectorMatches(env, matches);

  assert.equal(result.length, 1);
  assert.equal(result[0].metadata.reference_id, 2);
  assert.equal(result[0].metadata.capa_code, 'BQE1');
  assert.equal(result[0].metadata.reference_kind, 'product');
  assert.equal(result[0].metadata.image_key, 'products/bqe1.jpg');
});

test('Authoritative rebuild promotes the next active cover and recomputes retrieval telemetry', () => {
  const payload = {
    codes: ['JAEN1', 'BQE1', 'JADE'],
    scores: { JAEN1: 0.95, BQE1: 0.94, JADE: 0.91 },
    references: [],
    performance: {
      retrieval_top1: 0.95,
      retrieval_top1_code: 'JAEN1',
      retrieval_top2: 0.94,
      retrieval_top2_code: 'BQE1',
      retrieval_margin: 0.01,
      cover_candidate_count: 3
    }
  };

  const matches = [
    {
      score: 0.94,
      metadata: {
        reference_id: 2,
        capa_code: 'BQE1',
        image_key: 'products/bqe1.jpg',
        source_product_id: 20,
        reference_kind: 'product'
      },
      __candidate: {
        reference_id: 2,
        capa_code: 'BQE1',
        retrieval_score: 0.94,
        vector_rank: 2,
        image_key: 'products/bqe1.jpg'
      }
    },
    {
      score: 0.91,
      metadata: {
        reference_id: 3,
        capa_code: 'JADE',
        image_key: 'products/jade.jpg',
        source_product_id: 30,
        reference_kind: 'product'
      },
      __candidate: {
        reference_id: 3,
        capa_code: 'JADE',
        retrieval_score: 0.91,
        vector_rank: 3,
        image_key: 'products/jade.jpg'
      }
    }
  ];

  const rebuilt = rebuildPayloadFromAuthoritativeMatches(payload, matches);

  assert.deepEqual(rebuilt.payload.codes, ['BQE1', 'JADE']);
  assert.equal(rebuilt.payload.performance.retrieval_top1_code, 'BQE1');
  assert.equal(rebuilt.payload.performance.retrieval_top2_code, 'JADE');
  assert.equal(rebuilt.payload.performance.retrieval_top1, 0.94);
  assert.equal(rebuilt.payload.performance.retrieval_top2, 0.91);
  assert.ok(Math.abs(rebuilt.payload.performance.retrieval_margin - 0.03) < 1e-12);
  assert.equal(rebuilt.payload.performance.cover_candidate_count, 2);
  assert.equal(rebuilt.payload.performance.vector_authority, 'd1-active-reference');
});
