import test from 'node:test';
import assert from 'node:assert/strict';
import { createBarcodeZip, createEan13Svg, encodeEan13, safeBarcodeFilename } from '../src/ean-barcode.js';

test('EAN-13 encoder creates the official 95-module symbol', () => {
  const modules = encodeEan13('7898764983584');
  assert.equal(modules.length, 95);
  assert.equal(modules.startsWith('101'), true);
  assert.equal(modules.slice(45, 50), '01010');
  assert.equal(modules.endsWith('101'), true);
});

test('EAN-13 encoder rejects malformed or checksum-invalid values', () => {
  assert.throws(() => encodeEan13('7898764983585'), /EAN-13 inválido/);
  assert.throws(() => encodeEan13('123'), /EAN-13 inválido/);
});

test('barcode SVG includes product identity and printable bars', () => {
  const svg = createEan13Svg({ gtin: '7898764983584', sku: 'VACMNO_LIST3_BAA', nome: 'Caderneta', variacao: 'Listrado 3' }, { platform: 'SHOPEE' });
  assert.match(svg, /<svg/);
  assert.match(svg, /7898764983584/);
  assert.match(svg, /VACMNO_LIST3_BAA/);
  assert.match(svg, /SHOPEE/);
  assert.match(svg, /shape-rendering="crispEdges"/);
});

test('mass generation creates a ZIP with one label per selected product', async () => {
  const item = { id: 170, gtin: '7898764983584', sku: 'VACMNO_LIST3_BAA', nome: 'Caderneta', platforms: ['MERCADO LIVRE'] };
  const zip = createBarcodeZip([item], 'MERCADO LIVRE');
  const bytes = new Uint8Array(await zip.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(safeBarcodeFilename(item), 'VACMNO_LIST3_BAA_7898764983584.svg');
  assert.ok(bytes.length > 500);
});
