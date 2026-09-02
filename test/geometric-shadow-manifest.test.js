import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeometricCandidateRanking } from '../src/geometric-shadow-manifest.js';

test('Geometric Shadow Manifest: excludes held-out self and keeps distinct Top-10 covers', () => {
  const sample = { reference_id: 99, image_key: 'occurrences/self.jpg' };
  const matches = [
    { score: 0.99, metadata: { reference_id: 99, image_key: 'occurrences/self.jpg', capa_code: 'A', reference_kind: 'real_scan' } },
    { score: 0.95, metadata: { reference_id: 1, image_key: 'products/a.jpg', capa_code: 'A', reference_kind: 'product' } },
    { score: 0.94, metadata: { reference_id: 2, image_key: 'products/a2.jpg', capa_code: 'A', reference_kind: 'real_scan' } },
    { score: 0.93, metadata: { reference_id: 3, image_key: 'products/b.jpg', capa_code: 'B', reference_kind: 'product' } }
  ];
  const ranking = buildGeometricCandidateRanking(matches, sample, 10);
  assert.deepEqual(ranking.map(item => item.capa_code), ['A', 'B']);
  assert.equal(ranking[0].reference_id, 1);
  assert.equal(ranking[0].vector_rank, 2);
  assert.equal(ranking[1].cover_rank, 2);
});

test('Geometric Shadow Manifest: limits reranking to ten distinct covers', () => {
  const matches = Array.from({ length: 14 }, (_, i) => ({
    score: 0.99 - i * 0.01,
    metadata: {
      reference_id: i + 1,
      image_key: `products/c${i + 1}.jpg`,
      capa_code: `C${i + 1}`,
      reference_kind: 'product'
    }
  }));
  const ranking = buildGeometricCandidateRanking(matches, {}, 10);
  assert.equal(ranking.length, 10);
  assert.equal(ranking[9].capa_code, 'C10');
});
