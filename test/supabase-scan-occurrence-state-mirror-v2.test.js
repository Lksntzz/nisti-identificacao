import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/202609081720_nisti_scan_occurrence_state_mirror_v2.sql';

test('scan occurrence mirror v2 preserves authoritative lifecycle state', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(
    sql,
    /status,\s*trained_capa_code,\s*trained_at,\s*created_at/i
  );

  assert.match(
    sql,
    /v_status,\s*NULLIF\(p_row->>'trained_capa_code', ''\),\s*NULLIF\(p_row->>'trained_at', ''\)::TIMESTAMPTZ/i
  );

  assert.match(sql, /status\s*=\s*EXCLUDED\.status/i);
  assert.match(
    sql,
    /trained_capa_code\s*=\s*EXCLUDED\.trained_capa_code/i
  );
  assert.match(
    sql,
    /trained_at\s*=\s*EXCLUDED\.trained_at/i
  );
});

test('scan occurrence mirror v2 fails closed for invalid lifecycle states', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(
    sql,
    /v_status NOT IN \('pending', 'trained', 'dismissed'\)/i
  );

  assert.match(
    sql,
    /RAISE EXCEPTION 'invalid scan occurrence status: %', v_status/i
  );

  assert.match(
    sql,
    /USING ERRCODE = '22023'/i
  );
});

test('scan occurrence mirror v2 remains invoker-only and service-role-only', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /SECURITY INVOKER/i);
  assert.doesNotMatch(sql, /SECURITY DEFINER/i);

  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.nisti_mirror_scan_occurrence\(JSONB\)[\s\S]*FROM PUBLIC, anon, authenticated/i
  );

  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.nisti_mirror_scan_occurrence\(JSONB\)[\s\S]*TO service_role/i
  );
});
