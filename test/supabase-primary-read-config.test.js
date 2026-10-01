import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const wrangler = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('cutover snapshot keeps global Supabase reads disabled', () => {
  assert.match(wrangler, /SUPABASE_READS_ENABLED\s*=\s*"0"/);
  assert.match(wrangler, /SUPABASE_EMERGENCY_FALLBACK_ENABLED\s*=\s*"1"/);
});
