import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const publicMain = fs.readFileSync('src/public-main.jsx','utf8');

test('operator reads stay on the same-origin Worker boundary', () => {
  assert.doesNotMatch(publicMain,/operator-direct-read/);
  assert.doesNotMatch(publicMain,/supportsDirectOperatorRead/);
  assert.doesNotMatch(publicMain,/directOperatorRead/);
  assert.doesNotMatch(publicMain,/supabase\.co\/functions\/v1\/operator-read/);
  assert.match(publicMain,/fetch\(path, \{/);
  assert.match(publicMain,/credentials:'same-origin'/);
});

test('public client contains no Supabase service credentials', () => {
  assert.doesNotMatch(publicMain,/SERVICE_ROLE|service_role|apikey/i);
});
