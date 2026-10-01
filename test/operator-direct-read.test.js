import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const client = fs.readFileSync('src/operator-direct-read.js', 'utf8');
const publicMain = fs.readFileSync('src/public-main.jsx', 'utf8');
const edge = fs.readFileSync('supabase/functions/operator-read/index.ts', 'utf8');

test('operator notifications fall back directly to Supabase when Worker is unavailable', () => {
  assert.match(client, /operator-read/);
  assert.match(client, /notifications-unread/);
  assert.match(client, /mural-unread/);
  assert.match(publicMain, /supportsDirectOperatorRead/);
  assert.match(publicMain, /directOperatorRead/);
  assert.match(publicMain, /500, 502, 503, 504/);
});

test('direct operator Edge Function keeps service credentials server-side', () => {
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /nisti_reserve_notifications_v1/);
  assert.match(edge, /nisti_reserve_mural_unread_v1/);
  assert.doesNotMatch(client, /SERVICE_ROLE|service_role|apikey/i);
});
