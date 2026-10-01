import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const scanner = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');
const directLookup = fs.readFileSync(new URL('../src/gtin-supabase-lookup.js', import.meta.url), 'utf8');
const edgeFunction = fs.readFileSync(new URL('../supabase/functions/gtin-lookup/index.ts', import.meta.url), 'utf8');

test('scanner resolves EAN through Supabase before the legacy Worker route', () => {
  assert.match(scanner, /lookupGtinDirect\(gtin\)/);
  const directIndex = scanner.indexOf('lookupGtinDirect(gtin)');
  const workerIndex = scanner.indexOf('fetch(`/api/gtin/${encodeURIComponent(gtin)}`');
  assert.ok(directIndex >= 0);
  assert.ok(workerIndex > directIndex);
});

test('Cloudflare telemetry is best effort and cannot block an identified product', () => {
  assert.match(scanner, /void fetch\('\/api\/gtin-events'/);
  assert.match(scanner, /\.catch\(\(\) => \{\}\)/);
});

test('scanner retains a local last-resort lookup path', () => {
  assert.match(scanner, /cachedProductForGtin\(gtin\)/);
  assert.match(scanner, /loadGtinHistory\(\)\.find/);
});

test('browser direct lookup calls only the dedicated Supabase Edge Function', () => {
  assert.match(directLookup, /supabase\.co\/functions\/v1\/gtin-lookup/);
  assert.doesNotMatch(directLookup, /service[_-]?role/i);
  assert.doesNotMatch(directLookup, /apikey/i);
  assert.match(directLookup, /response\.status === 404/);
});

test('Edge Function validates GTIN and keeps service credentials server-side', () => {
  assert.match(edgeFunction, /\^\\d\{13\}\$/);
  assert.match(edgeFunction, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(edgeFunction, /nisti_reserve_gtin_lookup_v1/);
  assert.match(edgeFunction, /method !== "GET"/);
});
