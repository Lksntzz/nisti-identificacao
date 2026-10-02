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
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('Supabase write mode explicitly supports off, mirror and primary', () => {
  assert.equal(supabaseWriteMode({}), 'off');
  assert.equal(supabaseWriteMode({ SUPABASE_WRITE_MODE: 'off' }), 'off');
  assert.equal(supabaseWriteMode({ SUPABASE_WRITE_MODE: 'mirror' }), 'mirror');
  assert.equal(supabaseWriteMode({ SUPABASE_WRITE_MODE: 'primary' }), 'primary');
  assert.equal(supabaseMirrorWritesRequested({ SUPABASE_WRITE_MODE: 'mirror' }), true);
  assert.equal(supabaseMirrorWritesRequested({ SUPABASE_WRITE_MODE: 'primary' }), true);
  assert.equal(supabasePrimaryWritesRequested({ SUPABASE_WRITE_MODE: 'primary' }), true);
  assert.equal(supabasePrimaryWritesRequested({ SUPABASE_WRITE_MODE: 'mirror' }), false);
  assert.throws(
    () => supabaseWriteMode({ SUPABASE_WRITE_MODE: 'unexpected' }),
    /SUPABASE_WRITE_MODE inválido/
  );
});

test('write mirror does not contact Supabase while mode is off', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response();
  };
  try {
    const result = await mirrorSupabaseRpc(
      { ...configuredEnv, SUPABASE_WRITE_MODE: 'off' },
      'nisti_mirror_scan_occurrence',
      { p_row: { id: 1 } }
    );
    assert.deepEqual(result, { attempted: false, ok: true });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('write mirror calls service-role RPC in mirror mode and does not throw on target outage', async () => {
  const originalFetch = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init };
    return response('true');
  };
  try {
    const result = await mirrorSupabaseRpc(
      { ...configuredEnv, SUPABASE_WRITE_MODE: 'mirror' },
      'nisti_mirror_scan_occurrence',
      { p_row: { id: 274 } }
    );
    assert.deepEqual(result, { attempted: true, ok: true, value: true });
    assert.match(seen.url, /\/rpc\/nisti_mirror_scan_occurrence$/);
    assert.equal(JSON.parse(seen.init.body).p_row.id, 274);
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => response('{"message":"temporary"}', 503);
  try {
    const result = await mirrorSupabaseRpc(
      { ...configuredEnv, SUPABASE_WRITE_MODE: 'mirror' },
      'nisti_mirror_scan_occurrence',
      { p_row: { id: 274 } }
    );
    assert.equal(result.attempted, true);
    assert.equal(result.ok, false);
    assert.equal(result.error?.status, 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('primary write mode fails closed when Supabase does not confirm the RPC', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response('{"message":"temporary"}', 503);
  try {
    await assert.rejects(
      () => mirrorSupabaseRpc(
        { ...configuredEnv, SUPABASE_WRITE_MODE: 'primary' },
        'nisti_mirror_scan_occurrence',
        { p_row: { id: 274 } }
      ),
      error => error?.status === 503 && error?.code === 'supabase_rpc_503'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mirror RPC migration is retry-safe and service-role only', () => {
  const source = fs.readFileSync('supabase/migrations/202609050315_nisti_operator_write_mirror_rpc_v1.sql', 'utf8');
  const functions = [
    'nisti_mirror_scan_occurrence',
    'nisti_mirror_recognition_event',
    'nisti_mirror_geometric_shadow_evidence',
    'nisti_mirror_link_geometric_shadow',
    'nisti_mirror_confirm_geometric_shadow'
  ];

  for (const name of functions) {
    assert.match(source, new RegExp(`FUNCTION public\\.${name}`));
  }
  assert.match(source, /SECURITY INVOKER/g);
  assert.doesNotMatch(source, /SECURITY DEFINER/i);
  assert.match(source, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(source, /GET DIAGNOSTICS v_inserted = ROW_COUNT/);
  assert.match(source, /IF v_inserted = 0 THEN[\s\S]*RETURN TRUE/);
  assert.match(source, /ON CONFLICT \(evidence_token\) DO UPDATE/);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.nisti_mirror_scan_occurrence\(JSONB\) FROM PUBLIC, anon, authenticated/);
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.nisti_mirror_confirm_geometric_shadow[\s\S]*TO service_role/);
});

test('cutover release enables Supabase reads and strict primary writes with writes released', () => {
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
  assert.match(wrangler, /SUPABASE_READS_ENABLED\s*=\s*"1"/);
  assert.match(wrangler, /SUPABASE_WRITE_MODE\s*=\s*"primary"/);
  assert.match(wrangler, /SUPABASE_CUTOVER_WRITE_FREEZE\s*=\s*"0"/);
});
