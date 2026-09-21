import test from 'node:test';
import assert from 'node:assert/strict';
import { createEan13Svg, encodeEan13, safeBarcodeFilename, withPngDpiMetadata } from '../src/ean-barcode.js';

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

test('official barcode layout follows the 543x189 transparent-corner standard', () => {
  const svg = createEan13Svg({ gtin: '7898764983584' });
  assert.match(svg, /<svg/);
  assert.match(svg, /width="543" height="189"/);
  assert.match(svg, /<rect width="543" height="189" rx="18" fill="#fff"/);
  assert.match(svg, /7898764983584/);
  assert.match(svg, /font-size="24"/);
  assert.match(svg, /height="92"/);
  assert.match(svg, /height="104"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.doesNotMatch(svg, /stroke=/);
});

test('official file name uses only the EAN number', () => {
  assert.equal(safeBarcodeFilename({ gtin: '7898764983584' }), 'EAN_7898764983584_padrao_oficial.png');
});

test('PNG metadata records 300 DPI through the pHYs chunk', async () => {
  const signature = new Uint8Array([137,80,78,71,13,10,26,10]);
  const ihdr = new Uint8Array([0,0,0,0,73,72,68,82,174,66,96,130]);
  const iend = new Uint8Array([0,0,0,0,73,69,78,68,174,66,96,130]);
  const png = await withPngDpiMetadata(new Blob([signature, ihdr, iend], { type: 'image/png' }), 300);
  const bytes = new Uint8Array(await png.arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  const offset = text.indexOf('pHYs');
  assert.ok(offset > 0);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(offset + 4, false), 11811);
  assert.equal(view.getUint32(offset + 8, false), 11811);
  assert.equal(bytes[offset + 12], 1);
});
