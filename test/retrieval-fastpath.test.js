import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateRetrievalFastPath,
  tryRetrievalFastPath
} from '../src/retrieval-fastpath.js';

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ''));
}

async function signTicket(secret, payload) {
  const material = await crypto.subtle.digest(
    'SHA-256',
    textBytes(`nisti-local-vision:${secret}`)
  );
  const key = await crypto.subtle.importKey(
    'raw',
    material,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const encoded = base64url(textBytes(JSON.stringify(payload)));
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, textBytes(encoded))
  );
  return `${encoded}.${base64url(signature)}`;
}

function payload(overrides = {}) {
  return {
    exp: Math.floor(Date.now() / 1000) + 120,
    platform: 'SHOPEE',
    codes: ['JADE'],
    scores: { JADE: 0.93 },
    references: [{
      reference_id: 1,
      capa_code: 'JADE',
      retrieval_score: 0.93,
      vector_rank: 1,
      reference_kind: 'product'
    }],
    performance: {
      total_ms: 1700,
      model: 'gemini-embedding-2',
      retrieval_top1: 0.9305,
      retrieval_top1_code: 'JADE',
      retrieval_top2: 0.9125,
      retrieval_top2_code: 'BQE1',
      retrieval_margin: 0.018,
      cover_candidate_count: 4
    },
    ...overrides
  };
}

test('Retrieval Fast Path: accepts a strong separated Top-1', () => {
  const decision = evaluateRetrievalFastPath(payload(), {
    RETRIEVAL_FASTPATH_MIN_SCORE: '0.925',
    RETRIEVAL_FASTPATH_MIN_MARGIN: '0.008'
  });

  assert.equal(decision.eligible, true);
  assert.equal(decision.capa_code, 'JADE');
  assert.equal(decision.reason, 'retrieval_score_margin_accept');
});

test('Retrieval Fast Path: rejects an ambiguous Top-1 margin', () => {
  const ticket = payload({
    performance: {
      total_ms: 1700,
      model: 'gemini-embedding-2',
      retrieval_top1: 0.9140163,
      retrieval_top1_code: 'BQE1',
      retrieval_top2: 0.91360027,
      retrieval_top2_code: 'JADE',
      retrieval_margin: 0.00041603,
      cover_candidate_count: 4
    },
    codes: ['BQE1'],
    scores: { BQE1: 0.9140163 },
    references: [{
      reference_id: 2,
      capa_code: 'BQE1',
      retrieval_score: 0.9140163,
      vector_rank: 1,
      reference_kind: 'product'
    }]
  });

  const decision = evaluateRetrievalFastPath(ticket, {
    RETRIEVAL_FASTPATH_MIN_SCORE: '0.925',
    RETRIEVAL_FASTPATH_MIN_MARGIN: '0.008'
  });

  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'top1_score_below_fastpath');
});

test('Retrieval Fast Path: resolves CAPA_CODE to catalog product without Gemini generation', async () => {
  const secret = 'test-api-key';
  const ticket = await signTicket(secret, payload());
  const form = new FormData();
  form.set('platform', 'SHOPEE');
  form.set('ticket', ticket);
  form.set('image', new File([new Uint8Array([1, 2, 3])], 'cover.jpg', {
    type: 'image/jpeg'
  }));

  const request = new Request('https://example.test/api/identify', {
    method: 'POST',
    body: form
  });

  const env = {
    GEMINI_API_KEY: secret,
    GEMINI_EMBEDDING_MODEL: 'gemini-embedding-2',
    RETRIEVAL_FASTPATH_MIN_SCORE: '0.925',
    RETRIEVAL_FASTPATH_MIN_MARGIN: '0.008',
    DB: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [{
              id: 10,
              sku: 'VACMNO_JADE_BAA',
              capa_code: 'JADE',
              image_key: 'products/jade.jpg',
              platform: 'SHOPEE',
              link: 'https://example.test/product'
            }]
          })
        })
      })
    }
  };

  const response = await tryRetrievalFastPath(request, env);
  assert.ok(response);
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.capa_code, 'JADE');
  assert.equal(data.product.sku, 'VACMNO_JADE_BAA');
  assert.equal(data.identified_by, 'platform-vectorize-v8.11-retrieval-fastpath');
  assert.equal(data.performance.gemini_calls, 0);
  assert.equal('gemini_ms' in data.performance, false);
  assert.equal(data.performance.pipeline_version, 'platform-vectorize-retrieval-fastpath-v8.11');
});
