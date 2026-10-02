import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const wrangler = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('production uses Supabase reads without stale D1 emergency fallback', () => {
  assert.match(wrangler, /SUPABASE_READS_ENABLED\s*=\s*"1"/);
  assert.match(wrangler, /SUPABASE_EMERGENCY_FALLBACK_ENABLED\s*=\s*"0"/);
  assert.match(wrangler, /SUPABASE_CUTOVER_WRITE_FREEZE\s*=\s*"0"/);
});
