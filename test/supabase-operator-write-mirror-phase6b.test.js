import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  mirrorSupabaseRpc,
  supabaseMirrorWritesRequested,
  supabasePrimaryWritesRequested,
  supabaseWriteMode
} from '../src/supabase-write-store.js';

const configuredEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
  SUPABASE_READ_TIMEOUT_MS: '1000'
};

function response(body = 'true', status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

test('Supabase write mode explicitly supports off, mirror and primary', () => {
  assert.equal(supabaseWriteMode({}), 'off');
  assert.equal(supabaseWriteMode({ SUPABASE_WRITE_MODE: 'mirror' }), 'mirror');
  assert.equal(supabaseWriteMode({ SUPABASE_WRITE_MODE: 'primary' }), 'primary');
  assert.equal(supabaseMirrorWritesRequested({ SUPABASE_WRITE_MODE: 'mirror' }), true);
  assert.equal(supabasePrimaryWritesRequested({ SUPABASE_WRITE_MODE: 'primary' }), true);
  assert.throws(() => supabaseWriteMode({ SUPABASE_WRITE_MODE: 'unexpected' }),/SUPABASE_WRITE_MODE inválido/);
});

test('generic write RPC helper stays off when write mode is off', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return response(); };
  try {
    const result = await mirrorSupabaseRpc(
      { ...configuredEnv, SUPABASE_WRITE_MODE: 'off' },
      'nisti_record_gtin_scan_event_v1',
      { p_row: { id: 1 } }
    );
    assert.deepEqual(result, { attempted: false, ok: true });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('primary write mode fails closed when Supabase does not confirm an operational RPC', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response('{"message":"temporary"}', 503);
  try {
    await assert.rejects(
      () => mirrorSupabaseRpc(
        { ...configuredEnv, SUPABASE_WRITE_MODE: 'primary' },
        'nisti_record_gtin_scan_event_v1',
        { p_row: { id: 274 } }
      ),
      error => error?.status === 503 && error?.code === 'supabase_rpc_503'
    );
  } finally { globalThis.fetch = originalFetch; }
});

test('legacy operator recognition telemetry is removed', () => {
  assert.equal(fs.existsSync('src/recognition-metrics.js'), false);
  assert.equal(fs.existsSync('src/geometric-shadow-evidence-router.js'), false);
  const cleanup=fs.readFileSync('supabase/migrations/20261002115500_remove_ai_recognition_legacy.sql','utf8');
  assert.match(cleanup,/nisti_mirror_recognition_event/);
  assert.match(cleanup,/DROP TABLE IF EXISTS public\.recognition_events/);
});

test('cutover release keeps Supabase reads and strict primary writes enabled', () => {
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
  assert.match(wrangler, /SUPABASE_READS_ENABLED\s*=\s*"1"/);
  assert.match(wrangler, /SUPABASE_WRITE_MODE\s*=\s*"primary"/);
  assert.match(wrangler, /SUPABASE_CUTOVER_WRITE_FREEZE\s*=\s*"0"/);
});
