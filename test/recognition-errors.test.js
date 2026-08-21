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
    GEMINI_MODEL: 'gemini-2.5-flash',
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
            run: async () => ({ success: true })
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

test('Recognition Fast-Path: Instantly accepts trained real_scan reference (score >= 0.82)', async () => {
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

  const response = await structuralFinalIdentifyV8(request, env);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.capa_code, 'CP5');
  assert.equal(data.identified_by, 'platform-catalog-trained-real-scan-ground-truth');
});

test('Recognition Fallback: Handles Gemini API 500 error and falls back to choice options', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
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

    assert.equal(response.status, 200);
    assert.equal(data.multiple_choices, true);
    assert.equal(data.capa_code, 'CP4');
    assert.equal(data.products.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
