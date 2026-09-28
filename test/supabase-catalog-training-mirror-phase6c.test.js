import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mirrorProductCatalogBatchFromD1 } from '../src/supabase-write-store.js';

const configuredEnv = {
  SUPABASE_WRITE_MODE: 'mirror',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
  SUPABASE_READ_TIMEOUT_MS: '1000'
};

function response(body = 'null', status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('Phase 6C batch mirror reads committed D1 rows and emits one Supabase RPC', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const env = {
    ...configuredEnv,
    DB: {
      prepare(sql) {
        return {
          bind(...binds) {
            return {
              async all() {
                if (/FROM products/i.test(sql)) {
                  return {
                    results: binds.map(id => ({
                      id,
                      sku: `SKU-${id}`,
                      miolo_code: 'MI',
                      capa_code: `CP${id}`,
                      acabamento_code: 'AC',
                      wireo_code: 'BR',
                      tassel_code: 'X',
                      elastico_code: 'BR',
                      nome: null,
                      variacao: null,
                      image_key: null,
                      created_at: '2026-09-05T00:00:00Z',
                      updated_at: '2026-09-05T00:00:00Z'
                    }))
                  };
                }
                if (/FROM product_platforms/i.test(sql)) {
                  return {
                    results: binds.map((id, index) => ({
                      id: 100 + index,
                      product_id: id,
                      platform: 'SHOPEE',
                      link: null
                    }))
                  };
                }
                throw new Error(`SQL inesperado: ${sql}`);
              }
            };
          }
        };
      }
    }
  };

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return response();
  };

  try {
    const result = await mirrorProductCatalogBatchFromD1(env, [10, 11]);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rpc\/nisti_mirror_product_catalog_batch$/);
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.p_products.map(row => row.id), [10, 11]);
    assert.deepEqual(body.p_platforms.map(row => row.product_id), [10, 11]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Phase 6C mutation middleware covers all catalog and supervised-training write paths', () => {
  const source = fs.readFileSync('src/supabase-mutation-mirror.js', 'utf8');
  for (const expected of [
    '/api/products',
    '/api/admin/bulk-products',
    'api\\/products\\/(\\d+)\\/image',
    'api\\/admin\\/covers\\/([^/]+)\\/references',
    'api\\/admin\\/cover-references\\/(\\d+)',
    'api\\/admin\\/occurrences\\/(\\d+)\\/train',
    'api\\/admin\\/occurrences\\/(\\d+)\\/dismiss',
    '/api/operator/confirm-selection'
  ]) {
    assert.ok(source.includes(expected), `missing mirrored mutation path: ${expected}`);
  }
  assert.match(source, /mirrorProductCatalogBatchFromD1/);
  assert.match(source, /mirrorTrainedOccurrenceArtifactsFromD1/);
  assert.match(source, /mirrorDeletedVisualReferenceToSupabase/);
});

test('Phase 6C is wired after downstream success without cloning large image requests', () => {
  const source = fs.readFileSync('src/operator-audit-router.js', 'utf8');
  assert.match(source, /mirrorSuccessfulMutation/);
  assert.match(source, /const response = await app\.fetch\(request, env, ctx\);/);
  assert.match(source, /await mirrorSuccessfulMutation\(mirrorRequest, response, env\);/);
  assert.match(source, /url\.pathname === '\/api\/operator\/confirm-selection'[\s\S]*\? request\.clone\(\)/);
});

test('Phase 6C SQL is invoker-only, service-role-only and preserves D1 IDs', () => {
  const source = fs.readFileSync(
    'supabase/migrations/202609050345_nisti_catalog_training_mirror_rpc_v1.sql',
    'utf8'
  );

  for (const fn of [
    'nisti_mirror_product_catalog',
    'nisti_mirror_product_catalog_batch',
    'nisti_delete_product_catalog',
    'nisti_mirror_visual_reference',
    'nisti_delete_visual_reference'
  ]) {
    assert.match(source, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`));
    assert.match(source, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}`));
    assert.match(source, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}`));
  }

  assert.doesNotMatch(source, /SECURITY DEFINER/i);
  assert.ok((source.match(/SECURITY INVOKER/g) || []).length >= 5);
  assert.match(source, /INSERT INTO public\.products \(\s*id,/);
  assert.match(source, /INSERT INTO public\.product_platforms \(id,product_id,platform,link\)/);
  assert.match(source, /INSERT INTO public\.cover_visual_references \(\s*id,/);
});

test('Phase 6C does not enable production cutover switches', () => {
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
  assert.match(wrangler, /SUPABASE_WRITE_MODE\s*=\s*"off"/);
  assert.match(wrangler, /SUPABASE_READS_ENABLED\s*=\s*"0"/);
});
