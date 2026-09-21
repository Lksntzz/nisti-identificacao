import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/gtin-router.js', import.meta.url), 'utf8');
const scanner = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0017_gtin_scan_events.sql', import.meta.url), 'utf8');

test('EAN admin exposes registry, history and uncatalogued-code operations', () => {
  assert.match(main, /function GtinRegistryView/);
  assert.match(main, /function GtinEventsView/);
  assert.match(main, /ProductGtinManager/);
  assert.match(main, /activeView === 'historico-ean'/);
  assert.match(main, /activeView === 'ean-nao-cadastrados'/);
});

test('scanner records central EAN events for the admin history', () => {
  assert.match(scanner, /fetch\('\/api\/gtin-events'/);
  assert.match(scanner, /status: 'identified'/);
  assert.match(scanner, /status: 'not_found'/);
  assert.match(router, /\/api\/admin\/gtin-events/);
  assert.match(router, /\/api\/admin\/gtin-dashboard/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS gtin_scan_events/);
});
