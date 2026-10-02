import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SupabaseReadError,
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

test('legacy mode uses D1 directly only when Supabase reads are disabled', async () => {
  let supabaseCalls = 0;
  let d1Calls = 0;
  const value = await preferSupabaseRead(
    { SUPABASE_READS_ENABLED:'0' },
    async () => { supabaseCalls += 1; return 'supabase'; },
    async () => { d1Calls += 1; return 'd1'; },
    'legacy-explicit-mode'
  );
  assert.equal(value,'d1');
  assert.equal(supabaseCalls,0);
  assert.equal(d1Calls,1);
});

test('production Supabase read failures fail closed instead of serving stale D1', async () => {
  let d1Calls = 0;
  await assert.rejects(
    () => preferSupabaseRead(
      { ...configuredEnv, SUPABASE_EMERGENCY_FALLBACK_ENABLED: '0' },
      async () => {
        throw new SupabaseReadError('temporary', {
          status: 503,
          code: 'supabase_rpc_503',
          fallbackEligible: true
        });
      },
      async () => { d1Calls += 1; return 'stale-d1'; },
      'temporary'
    ),
    /temporary/
  );
  assert.equal(d1Calls, 0);
});

test('retryable Supabase failures never cross over to D1 while Supabase reads are enabled', async () => {
  let d1Calls = 0;
  await assert.rejects(
    () => preferSupabaseRead(
      configuredEnv,
      async () => {
        throw new SupabaseReadError('temporary', {
          status: 503,
          code: 'supabase_rpc_503',
          fallbackEligible: true
        });
      },
      async () => { d1Calls += 1; return 'stale-d1'; },
      'temporary-no-fallback'
    ),
    /temporary/
  );
  assert.equal(d1Calls, 0);
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

test('retired automatic visual fastpath stays removed', () => {
  assert.equal(fs.existsSync('src/retrieval-fastpath.js'), false);
  const images = fs.readFileSync('src/public-image-router.js', 'utf8');
  assert.match(images, /supabaseImageKey/);
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


test('critical reserve RPCs keep scanner and notification compatibility while occurrence runtime is retired', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20261001164500_supabase_emergency_critical_reads_v1.sql',
    'utf8'
  );
  const gtinRouter = fs.readFileSync('src/gtin-router.js', 'utf8');
  const notifications = fs.readFileSync('src/cover-notifications.js', 'utf8');
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');

  assert.match(migration, /nisti_reserve_gtin_lookup_v1/);
  assert.match(migration, /nisti_reserve_notifications_v1/);
  assert.match(migration, /nisti_reserve_unread_notifications_v1/);
  assert.doesNotMatch(migration, /SECURITY DEFINER/i);

  assert.match(gtinRouter, /preferSupabaseRead/);
  assert.match(gtinRouter, /supabaseReserveGtinLookup/);
  assert.equal(fs.existsSync('src/occurrences-router.js'), false);
  assert.match(notifications, /supabaseReserveNotifications/);
  assert.doesNotMatch(notifications, /supabaseReserveUnreadNotifications/);
  assert.match(notifications, /is_read/);
  assert.doesNotMatch(wrangler, /SUPABASE_EMERGENCY_/);
});

test('GTIN dashboard uses the Supabase reserve without touching D1 when reads are enabled', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20261001192000_gtin_dashboard_read_v1.sql',
    'utf8'
  );
  const router = fs.readFileSync('src/gtin-router.js', 'utf8');
  const store = fs.readFileSync('src/supabase-read-store.js', 'utf8');

  assert.match(migration, /nisti_reserve_gtin_dashboard_v1/);
  assert.match(migration, /SECURITY INVOKER/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.nisti_reserve_gtin_dashboard_v1\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.nisti_reserve_gtin_dashboard_v1\(\) TO service_role/);
  assert.doesNotMatch(migration, /SECURITY DEFINER/i);
  assert.match(store, /supabaseReserveGtinDashboard/);
  assert.match(router, /preferSupabaseRead[\s\S]*supabaseReserveGtinDashboard/);
});

test('primary operational writes bypass D1 for scanner events and mural reads', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20261001194000_primary_operational_writes_v1.sql',
    'utf8'
  );
  const gtin = fs.readFileSync('src/gtin-router.js', 'utf8');
  const mural = fs.readFileSync('src/mural-router.js', 'utf8');

  for (const name of [
    'nisti_record_gtin_scan_event_v1',
    'nisti_mark_mural_post_read_v1',
    'nisti_mark_all_mural_posts_read_v1'
  ]) assert.match(migration, new RegExp(name));
  assert.doesNotMatch(migration, /SECURITY DEFINER/i);
  assert.match(gtin, /supabasePrimaryWritesRequested[\s\S]*nisti_record_gtin_scan_event_v1[\s\S]*return;/);
  assert.match(mural, /supabasePrimaryWritesRequested[\s\S]*nisti_mark_mural_post_read_v1/);
  assert.match(mural, /nisti_mark_all_mural_posts_read_v1/);
});
