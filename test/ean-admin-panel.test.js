import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/gtin-router.js', import.meta.url), 'utf8');
const scanner = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');
const coreRouter = fs.readFileSync(new URL('../src/core-router.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0017_gtin_scan_events.sql', import.meta.url), 'utf8');
const gtinRegistry = fs.readFileSync(new URL('../src/admin/GtinRegistryView.jsx', import.meta.url), 'utf8');
const gtinEvents = fs.readFileSync(new URL('../src/admin/GtinEventsView.jsx', import.meta.url), 'utf8');
const barcodeGen = fs.readFileSync(new URL('../src/admin/BarcodeGeneratorView.jsx', import.meta.url), 'utf8');

test('EAN admin exposes registry, history and uncatalogued-code operations', () => {
  assert.match(gtinRegistry + main, /function GtinRegistryView/);
  assert.match(gtinEvents + main, /function GtinEventsView/);
  assert.match(main, /ProductGtinManager/);
  assert.match(main, /activeView === 'historico-ean'/);
  assert.match(main, /activeView === 'ean-nao-cadastrados'/);
});

test('scanner records central EAN events for the admin history', () => {
  assert.match(scanner, /'x-operator-name'/);
  assert.match(router, /scheduleGtinScanEvent\(ctx, request, env/);
  assert.match(router, /status: 'identified'/);
  assert.match(router, /status: 'not_found'/);
  assert.match(router, /\/api\/admin\/gtin-events/);
  assert.match(router, /\/api\/admin\/gtin-dashboard/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS gtin_scan_events/);
});

test('EAN history reports loading failures and offers retry', () => {
  assert.match(gtinEvents + main, /setLoadError\(error\?\.message/);
  assert.match(gtinEvents + main, /Tentar novamente/);
});

test('barcode generator exposes collection downloads without removing individual downloads', () => {
  assert.match(barcodeGen + main, /buildEanCollections/);
  assert.match(barcodeGen + main, /Baixar coleção/);
  assert.match(barcodeGen + main, /downloadCollection/);
  assert.match(barcodeGen + main, /Baixar PNG oficial/);
  assert.match(router, /p\.sku,p\.miolo_code,p\.nome/);
});

test('barcode generator presents collection download as an explicit view filter', () => {
  assert.match(barcodeGen + main, /const \[viewMode, setViewMode\]/);
  assert.match(barcodeGen + main, /Modo de download/);
  assert.match(barcodeGen + main, /Produtos individuais/);
  assert.match(barcodeGen + main, /Download por coleção/);
  assert.match(barcodeGen + main, /viewMode === 'collections'/);
});

test('new product registration writes its EAN atomically with an accepted source', () => {
  assert.match(main, /gtin: cleanGtin/);
  assert.doesNotMatch(main, /source: 'ADMIN'/);
  assert.match(coreRouter, /source='NISTI'/);
  assert.doesNotMatch(coreRouter, /source='IMPORT'/);
  assert.match(coreRouter, /upsertCatalogProduct\(env, body\)/);
});

test('manual and bulk registration immediately expose downloadable barcode labels', () => {
  assert.match(main, /function RegistrationBarcodeResult/);
  assert.match(main, /createEan13Svg\(item\)/);
  assert.match(main, /downloadBarcodePng\(item\)/);
  assert.match(main, /downloadBarcodeZip\(barcodeItems/);
  assert.match(main, /Baixar todas em ZIP/);
  assert.match(main, /setResult\(\{ items: registered, errors: failures \}\)/);
  assert.match(main, /setResult\(\{ items: importedItems, errors: importErrors, created, updated \}\)/);
});
