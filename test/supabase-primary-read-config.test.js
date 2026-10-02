import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const wrangler = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('production uses Supabase reads with no runtime D1 fallback configuration', () => {
  assert.match(wrangler, /SUPABASE_READS_ENABLED\s*=\s*"1"/);
  assert.doesNotMatch(wrangler, /SUPABASE_EMERGENCY_/);
  assert.match(wrangler, /SUPABASE_CUTOVER_WRITE_FREEZE\s*=\s*"0"/);
});
