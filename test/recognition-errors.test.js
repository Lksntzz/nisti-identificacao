import test from 'node:test';
import assert from 'node:assert/strict';
import { structuralFinalIdentifyV8 } from '../src/structural-final-v8.js';

// Base64url and HMAC helpers to sign mock tickets in tests
function base64url(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ''));
}

async function ticketKey(secret) {
  const material = await crypto.subtle.digest(
    'SHA-256',
    textBytes(`nisti-local-vision:${secret}`)
  );
  return crypto.subtle.importKey(
    'raw',
    material,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function signTicket(secret, payload) {
  const encoded = base64url(textBytes(JSON.stringify(payload)));
  const key = await ticketKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, textBytes(encoded))
  );
  return `${encoded}.${base64url(signature)}`;
}

// Helper mock structures for Cloudflare bindings
const createMockEnv = ({
  dbRows = {},
  vectorMatches = [],
  r2Object = null
} = {}) => {
  return {
    GEMINI_API_KEY: 'test-api-key',
    GEMINI_VERIFIER_MODEL: 'gemini-3.6-flash',
    GEMINI_MODEL: 'gemini-3.6-flash',
    GEMINI_EMBEDDING_MODEL: 'gemini-embedding-2',
    DB: {
      prepare: (sql) => {
        const cleanSql = sql.replace(/\s+/g, ' ').trim();
        return {
          bind: (...args) => ({
            first: async () => {
              if (cleanSql.includes('FROM cover_visual_references')) {
                return dbRows.reference || null;
              }
              if (cleanSql.includes('FROM products')) {
                return dbRows.product || null;
              }
              return null;
            },
            all: async () => {
              if (cleanSql.includes('FROM products')) {
                return { results: dbRows.products || [] };
              }
              return { results: [] };
            },
            run: async () => ({ success: true, meta: { changes: 1 } })
          }),
          first: async () => {
            if (cleanSql.includes('FROM scan_occurrences')) {
              return dbRows.occurrence || null;
            }
            return null;
          },
          all: async () => ({ results: [] }),
          run: async () => ({ success: true })
        };
      }
    },
    COVER_VECTORS: {
      query: async () => ({
        matches: vectorMatches
      })
    },
    PRODUCT_IMAGES: {
      get: async () => r2Object,
      put: async () => ({})
    }
  };
};

const createMockRequest = async (platform = 'SHOPEE', ticketPayload = null) => {
  const formData = new FormData();
  const blob = new Blob(['fake-image-bytes'], { type: 'image/jpeg' });
  formData.append('image', blob, 'cover.jpg');
  formData.append('platform', platform);

  const headers = new Headers();
  if (ticketPayload) {
    const payloadWithExp = {
      ...ticketPayload,
      exp: Math.floor(Date.now() / 1000) + 120
    };
    const secret = 'test-api-key';
    const signedTicket = await signTicket(secret, payloadWithExp);
    headers.append('Cookie', `nisti_recognition_ticket=${signedTicket}`);
  }

  return new Request('https://nisti.print/api/identify', {
    method: 'POST',
    body: formData,
    headers
  });
};

test('Recognition Error: Reject low vector retrieval score (< 0.45)', async () => {
  const env = createMockEnv();
  const ticketPayload = {
    platform: 'SHOPEE',
    performance: { retrieval_top1: 0.35 },
    codes: ['CP4'],
    scores: { CP4: 0.35 },
    references: [{ reference_id: 1, capa_code: 'CP4', retrieval_score: 0.35, vector_rank: 1 }]
  };
  const request = await createMockRequest('SHOPEE', ticketPayload);

  const response = await structuralFinalIdentifyV8(request, env);
  const data = await response.json();

  assert.equal(response.status, 422);
  assert.match(data.error, /Produto não corresponde ao catálogo/);
  assert.equal(data.technical_error, 'low_retrieval_score_barrier');
});

test('Recognition Error: Handles missing catalog images gracefully', async () => {
  const env = createMockEnv({
    r2Object: null,
    dbRows: {
      reference: { id: 1, capa_code: 'CP4', image_key: 'mocks/cp4.jpg', reference_kind: 'product' }
    }
  });

  const ticketPayload = {
    platform: 'SHOPEE',
    performance: { retrieval_top1: 0.85 },
    codes: ['CP4'],
    scores: { CP4: 0.85 },
    references: [{ reference_id: 1, capa_code: 'CP4', retrieval_score: 0.85, vector_rank: 1 }]
  };
  const request = await createMockRequest('SHOPEE', ticketPayload);

  const response = await structuralFinalIdentifyV8(request, env);
  const data = await response.json();

  assert.equal(response.status, 503);
  assert.equal(data.technical_error, 'candidate_images_missing');
});

test('Recognition Verification: trained real_scan still requires one exact Gemini confirmation', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  let requestedUrl = '';
  global.fetch = async (url) => {
    fetchCalls += 1;
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              winner_code: 'CP5',
              exact_match: true,
              confidence: 0.96,
              reason_code: 'exact_base_art'
            })
          }]
        }
      }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const fakeBytes = new Uint8Array([1, 2, 3]);
  const env = createMockEnv({
    r2Object: {
      arrayBuffer: async () => fakeBytes.buffer,
      httpMetadata: { contentType: 'image/jpeg' }
    },
    dbRows: {
      reference: { id: 99, capa_code: 'CP5', image_key: 'trained/cp5.jpg', reference_kind: 'real_scan' },
      products: [{ id: 10, sku: 'VACMNO_CP5_BAA', capa_code: 'CP5' }]
    }
  });

  const ticketPayload = {
    platform: 'SHOPEE',
    performance: { retrieval_top1: 0.89 },
    codes: ['CP5'],
    scores: { CP5: 0.89 },
    references: [{ reference_id: 99, capa_code: 'CP5', retrieval_score: 0.89, vector_rank: 1, reference_kind: 'real_scan' }]
  };
  const request = await createMockRequest('SHOPEE', ticketPayload);

  try {
    const response = await structuralFinalIdentifyV8(request, env);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.capa_code, 'CP5');
    assert.equal(data.identified_by, 'platform-catalog-v8.8-comparative-winner');
    assert.equal(fetchCalls, 1);
    assert.match(requestedUrl, /models\/gemini-3\.6-flash:generateContent$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Recognition Fail-Closed: Gemini API 500 does not expose unconfirmed candidate products', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ error: { message: 'Gemini internal error' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  };

  const fakeBytes = new Uint8Array([1, 2, 3]);
  const env = createMockEnv({
    r2Object: {
      arrayBuffer: async () => fakeBytes.buffer,
      httpMetadata: { contentType: 'image/jpeg' }
    },
    dbRows: {
      reference: { id: 4, capa_code: 'CP4', image_key: 'mocks/cp4.jpg', reference_kind: 'product' },
      products: [{ id: 2, sku: 'VACMNO_CP4_BBB', capa_code: 'CP4' }]
    }
  });

  const ticketPayload = {
    platform: 'SHOPEE',
    performance: { retrieval_top1: 0.75 },
    codes: ['CP4'],
    scores: { CP4: 0.75 },
    references: [{ reference_id: 4, capa_code: 'CP4', retrieval_score: 0.75, vector_rank: 1, reference_kind: 'product' }]
  };
  const request = await createMockRequest('SHOPEE', ticketPayload);

  try {
    const response = await structuralFinalIdentifyV8(request, env);
    const data = await response.json();

    assert.equal(response.status, 422);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(data.suggestions, []);
    assert.equal(data.suggestions_are_unconfirmed, false);
    assert.equal(data.multiple_choices, undefined);
    assert.equal(data.performance.comparator_error, 'catalog_comparator_http_500');
    assert.equal(data.performance.gemini_calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Recognition Fail-Closed: high confidence without exact_match is not accepted', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              winner_code: 'CP4',
              exact_match: false,
              confidence: 0.99,
              reason_code: 'different_layout'
            })
          }]
        }
      }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const fakeBytes = new Uint8Array([1, 2, 3]);
  const env = createMockEnv({
    r2Object: {
      arrayBuffer: async () => fakeBytes.buffer,
      httpMetadata: { contentType: 'image/jpeg' }
    },
    dbRows: {
      reference: { id: 4, capa_code: 'CP4', image_key: 'mocks/cp4.jpg', reference_kind: 'product' },
      products: [{ id: 2, sku: 'VACMNO_CP4_BBB', capa_code: 'CP4' }]
    }
  });

  const ticketPayload = {
    platform: 'SHOPEE',
    performance: { retrieval_top1: 0.91 },
    codes: ['CP4'],
    scores: { CP4: 0.91 },
    references: [{ reference_id: 4, capa_code: 'CP4', retrieval_score: 0.91, vector_rank: 1, reference_kind: 'product' }]
  };
  const request = await createMockRequest('SHOPEE', ticketPayload);

  try {
    const response = await structuralFinalIdentifyV8(request, env);
    const data = await response.json();

    assert.equal(response.status, 422);
    assert.equal(data.identified_by, 'platform-catalog-no-match-v8.8');
    assert.equal(data.performance.gemini_confidence, 0.99);
    assert.equal(data.performance.verifier_reason_code, 'different_layout');
  } finally {
    global.fetch = originalFetch;
  }
});
