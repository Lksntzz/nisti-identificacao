import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Supabase cutover is configured but disabled by default', () => {
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
  assert.match(wrangler, /SUPABASE_URL = "https:\/\/yioetdcbgorunwgwuawg\.supabase\.co"/);
  assert.match(wrangler, /SUPABASE_READS_ENABLED = "0"/);
  assert.match(wrangler, /SUPABASE_READ_TIMEOUT_MS = "2500"/);
  assert.doesNotMatch(wrangler, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(wrangler, /RETRIEVAL_FASTPATH_MIN_SCORE = "0\.920"/);
  assert.match(wrangler, /RETRIEVAL_FASTPATH_MIN_MARGIN = "0\.008"/);
});

test('cutover runbook keeps service role secret out of repository', () => {
  const source = fs.readFileSync('supabase/CUTOVER.md', 'utf8');
  assert.match(source, /wrangler secret put SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /SUPABASE_READS_ENABLED=1/);
  assert.match(source, /13 tabelas importadas/);
  assert.match(source, /Não alterar os thresholds/);
});
