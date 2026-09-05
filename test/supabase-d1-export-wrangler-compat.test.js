import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scriptUrl = new URL('../scripts/export-d1-for-supabase.ps1', import.meta.url);

test('D1 export script remains compatible with pinned Wrangler 3.114.17', async () => {
  const script = await readFile(scriptUrl, 'utf8');

  assert.match(script, /3\\\.114\\\.17/);
  assert.match(script, /'d1', 'export', \$Database/);
  assert.match(script, /'--remote'/);
  assert.match(script, /'--no-data'/);
  assert.match(script, /'--no-schema'/);
  assert.doesNotMatch(script, /'--skip-confirmation'/);
});
