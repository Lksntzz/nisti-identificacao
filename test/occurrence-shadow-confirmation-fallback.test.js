import test from 'node:test';
import assert from 'node:assert/strict';
import { trainOccurrenceDirectly } from '../src/occurrences-router.js';

test('v8.24.2 training falls back to photo SHA when shadow evidence has no occurrence_id', async () => {
  const originalFetch = global.fetch;
  const photoBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const confirmationUpdates = [];

  global.fetch = async () => new Response(JSON.stringify({
    embedding: { values: Array.from({ length: 768 }, (_, index) => index / 1000) }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  const env = {
    GEMINI_API_KEY: 'test-key',
    GEMINI_EMBEDDING_MODEL: 'gemini-embedding-2',
    PRODUCT_IMAGES: {
      get: async key => key === 'occurrences/review.jpg'
        ? {
            arrayBuffer: async () => photoBytes.slice().buffer
          }
        : null
    },
    DB: {
      prepare(sql) {
        const clean = String(sql).replace(/\s+/g, ' ').trim();
        return {
          bind(...args) {
            return {
              async first() {
                if (clean.includes('FROM scan_occurrences WHERE id=?')) {
                  return { id: 501, image_key: 'occurrences/review.jpg', platform: 'SHOPEE' };
                }
                if (clean.includes('FROM cover_visual_references WHERE capa_code=? AND image_key=?')) {
                  return { id: 777 };
                }
                return null;
              },
              async run() {
                if (clean.includes('UPDATE geometric_shadow_evidence') && clean.includes('WHERE occurrence_id=?')) {
                  confirmationUpdates.push({ type: 'occurrence', args });
                  return { meta: { changes: 0 } };
                }
                if (clean.includes('UPDATE geometric_shadow_evidence') && clean.includes('WHERE photo_sha256=?')) {
                  confirmationUpdates.push({ type: 'sha', args });
                  return { meta: { changes: 1 } };
                }
                return { success: true, meta: { changes: 1, last_row_id: 777 } };
              },
              async all() {
                return { results: [] };
              }
            };
          }
        };
      }
    }
  };

  try {
    const result = await trainOccurrenceDirectly(env, 501, 'LIN2', 'Lukas - ADM');

    assert.equal(result.ok, true);
    assert.equal(result.trained, true);
    assert.equal(result.capa_code, 'LIN2');
    assert.deepEqual(confirmationUpdates.map(item => item.type), ['occurrence', 'sha']);
    assert.equal(confirmationUpdates[0].args[0], 'LIN2');
    assert.equal(confirmationUpdates[0].args[1], 'operator_confirmed_training');
    assert.equal(confirmationUpdates[0].args[2], 501);
    assert.equal(confirmationUpdates[1].args[0], 'LIN2');
    assert.equal(confirmationUpdates[1].args[1], 'operator_confirmed_training');
    assert.match(String(confirmationUpdates[1].args[2]), /^[a-f0-9]{64}$/);
  } finally {
    global.fetch = originalFetch;
  }
});
