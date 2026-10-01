import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SupabaseReadError,
  isD1DailyReadLimitError,
  preferSupabaseRead,
  supabaseRpc
} from '../src/supabase-read-store.js';
import {
  listPlatforms,
  platformExists
} from '../src/platform-scope.js';

const configuredEnv = {
  SUPABASE_READS_ENABLED: '1',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
  SUPABASE_READ_TIMEOUT_MS: '1000'
};

function response(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('disabled switch stays on D1 and never calls Supabase', async () => {
  let supabaseCalls = 0;
  let d1Calls = 0;
  const value = await preferSupabaseRead(
    { SUPABASE_READS_ENABLED: '0' },
    async () => { supabaseCalls += 1; return 'supabase'; },
    async () => { d1Calls += 1; return 'd1'; },
    'test'
  );
  assert.equal(value, 'd1');
  assert.equal(supabaseCalls, 0);
  assert.equal(d1Calls, 1);
});

test('valid empty Supabase result is authoritative and does not fall back', async () => {
  let d1Calls = 0;
  const value = await preferSupabaseRead(
    configuredEnv,
    async () => [],
    async () => { d1Calls += 1; return ['stale-d1']; },
    'empty-authoritative'
  );
  assert.deepEqual(value, []);
  assert.equal(d1Calls, 0);
});

test('transport/server failure may use temporary D1 fallback', async () => {
  let d1Calls = 0;
  const value = await preferSupabaseRead(
    configuredEnv,
    async () => {
      throw new SupabaseReadError('temporary', {
        status: 503,
        code: 'supabase_rpc_503',
        fallbackEligible: true
      });
    },
    async () => { d1Calls += 1; return 'd1'; },
    'temporary'
  );
  assert.equal(value, 'd1');
  assert.equal(d1Calls, 1);
});

test('configuration/auth errors fail closed and do not hide behind D1', async () => {
  let d1Calls = 0;
  await assert.rejects(
    () => preferSupabaseRead(
      configuredEnv,
      async () => {
        throw new SupabaseReadError('unauthorized', {
          status: 401,
          code: 'supabase_rpc_401',
          fallbackEligible: false
        });
      },
      async () => { d1Calls += 1; return 'd1'; },
      'auth'
    ),
    /unauthorized/
  );
  assert.equal(d1Calls, 0);
});

test('RPC client sends service credential only in server request headers', async () => {
  const originalFetch = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init };
    return response('true');
  };
  try {
    assert.equal(await supabaseRpc(configuredEnv, 'nisti_platform_exists', { p_platform: 'SHOPEE' }), true);
    assert.equal(seen.url, 'https://example.supabase.co/rest/v1/rpc/nisti_platform_exists');
    assert.equal(seen.init.headers.apikey, 'server-secret');
    assert.equal(seen.init.headers.authorization, 'Bearer server-secret');
    assert.equal(JSON.parse(seen.init.body).p_platform, 'SHOPEE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('platform list uses Supabase as authoritative source when enabled', async () => {
  const originalFetch = globalThis.fetch;
  let d1Touched = false;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /nisti_list_platforms$/);
    return response(JSON.stringify([
      { platform: 'SHOPEE', product_count: 321 },
      { platform: 'AMAZON', product_count: 17 }
    ]));
  };
  const env = {
    ...configuredEnv,
    DB: {
      prepare() {
        d1Touched = true;
        throw new Error('D1 must not be touched for a valid Supabase response');
      }
    }
  };
  try {
    const platforms = await listPlatforms(env);
    assert.deepEqual(platforms, [
      { platform: 'MERCADO LIVRE', platform_key: 'mercado-livre', product_count: 0 },
      { platform: 'SHOPEE', platform_key: 'shopee', product_count: 321 },
      { platform: 'AMAZON', platform_key: 'amazon', product_count: 17 }
    ]);
    assert.equal(d1Touched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('platformExists false from Supabase stays false instead of querying stale D1', async () => {
  const originalFetch = globalThis.fetch;
  let d1Touched = false;
  globalThis.fetch = async () => response('false');
  const env = {
    ...configuredEnv,
    DB: {
      prepare() {
        d1Touched = true;
        throw new Error('D1 must not be touched');
      }
    }
  };
  try {
    assert.equal(await platformExists(env, 'SHOPEE'), false);
    assert.equal(d1Touched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('RPC migration is service-role only and never SECURITY DEFINER', () => {
  const source = fs.readFileSync('supabase/migrations/202609042020_nisti_operator_read_rpc_v1.sql', 'utf8');
  assert.match(source, /SECURITY INVOKER/g);
  assert.doesNotMatch(source, /SECURITY DEFINER/i);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.nisti_list_platforms\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.nisti_products_for_cover\(TEXT, TEXT\) TO service_role/);
});

test('critical fastpath and Vectorize authority are wired to preferred store', () => {
  const fastpath = fs.readFileSync('src/retrieval-fastpath.js', 'utf8');
  const authority = fs.readFileSync('src/vector-match-authority.js', 'utf8');
  const images = fs.readFileSync('src/public-image-router.js', 'utf8');
  assert.match(fastpath, /supabaseProductsForCover/);
  assert.match(fastpath, /preferSupabaseRead/);
  assert.match(authority, /supabaseActiveReferences/);
  assert.match(images, /supabaseImageKey/);
});


test('emergency reserve fallback uses Supabase only for the D1 daily row-read limit', async () => {
  let supabaseCalls = 0;
  const env = {
    SUPABASE_READS_ENABLED: '0',
    SUPABASE_EMERGENCY_FALLBACK_ENABLED: '1'
  };

  const value = await preferSupabaseRead(
    env,
    async () => { supabaseCalls += 1; return 'supabase-reserve'; },
    async () => { throw new Error("Your account has exceeded D1's free tier daily row read limit. [code: 7500]"); },
    'quota-test'
  );

  assert.equal(value, 'supabase-reserve');
  assert.equal(supabaseCalls, 1);
  assert.equal(isD1DailyReadLimitError(new Error('daily row read limit exceeded')), true);
});

test('emergency reserve does not hide unrelated D1 failures', async () => {
  let supabaseCalls = 0;
  await assert.rejects(
    () => preferSupabaseRead(
      {
        SUPABASE_READS_ENABLED: '0',
        SUPABASE_EMERGENCY_FALLBACK_ENABLED: '1'
      },
      async () => { supabaseCalls += 1; return 'supabase'; },
      async () => { throw new Error('D1 schema mismatch'); },
      'schema-test'
    ),
    /schema mismatch/
  );
  assert.equal(supabaseCalls, 0);
});

test('emergency reserve stays disabled unless explicitly enabled', async () => {
  let supabaseCalls = 0;
  await assert.rejects(
    () => preferSupabaseRead(
      { SUPABASE_READS_ENABLED: '0' },
      async () => { supabaseCalls += 1; return 'supabase'; },
      async () => { throw new Error("exceeded D1's free tier daily row read limit"); },
      'disabled-emergency'
    ),
    /row read limit/
  );
  assert.equal(supabaseCalls, 0);
});

test('reserve catalog RPC is service-role only', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20261001162000_supabase_emergency_read_fallback_v1.sql',
    'utf8'
  );
  assert.match(migration, /FUNCTION public\.nisti_reserve_products_v1/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.nisti_reserve_products_v1\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.nisti_reserve_products_v1\(\) TO service_role/);
  assert.doesNotMatch(migration, /SECURITY DEFINER/i);
});

test('public product images use preferred store for treated and original keys', () => {
  const images = fs.readFileSync('src/public-image-router.js', 'utf8');
  assert.match(images, /imageKey\(env, 'mural-product'/);
  assert.match(images, /imageKey\(env, 'product'/);
});
