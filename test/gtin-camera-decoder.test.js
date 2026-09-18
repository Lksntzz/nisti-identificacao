import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEan13Bits, decodeEan13LumaRow } from '../src/gtin-camera-decoder.js';

const L = {
  0:'0001101',1:'0011001',2:'0010011',3:'0111101',4:'0100011',
  5:'0110001',6:'0101111',7:'0111011',8:'0110111',9:'0001011'
};
const G = {
  0:'0100111',1:'0110011',2:'0011011',3:'0100001',4:'0011101',
  5:'0111001',6:'0000101',7:'0010001',8:'0001001',9:'0010111'
};
const R = {
  0:'1110010',1:'1100110',2:'1101100',3:'1000010',4:'1011100',
  5:'1001110',6:'1010000',7:'1000100',8:'1001000',9:'1110100'
};
const PARITY = {
  0:'LLLLLL',1:'LLGLGG',2:'LLGGLG',3:'LLGGGL',4:'LGLLGG',
  5:'LGGLLG',6:'LGGGLL',7:'LGLGLG',8:'LGLGGL',9:'LGGLGL'
};

function encodeEan13(ean) {
  let bits = '101';
  for (let i = 1; i <= 6; i += 1) {
    bits += PARITY[ean[0]][i - 1] === 'L' ? L[ean[i]] : G[ean[i]];
  }
  bits += '01010';
  for (let i = 7; i < 13; i += 1) bits += R[ean[i]];
  bits += '101';
  return bits;
}

function renderLuma(bits, moduleWidth = 4, quietModules = 12) {
  const width = (bits.length + quietModules * 2) * moduleWidth;
  const luma = new Uint8Array(width);
  luma.fill(245);
  const offset = quietModules * moduleWidth;
  for (let i = 0; i < bits.length; i += 1) {
    const value = bits[i] === '1' ? 18 : 242;
    for (let px = 0; px < moduleWidth; px += 1) luma[offset + i * moduleWidth + px] = value;
  }
  return luma;
}

test('decodes exact EAN-13 module pattern', () => {
  const ean = '7898764983751';
  assert.equal(decodeEan13Bits(encodeEan13(ean)), ean);
});

test('decodes EAN-13 from a synthetic camera scan row', () => {
  const ean = '7898764983768';
  const luma = renderLuma(encodeEan13(ean), 5, 14);
  assert.equal(decodeEan13LumaRow(luma), ean);
});

test('rejects a checksum-invalid pattern', () => {
  const invalid = '7898764983769';
  assert.equal(decodeEan13Bits(encodeEan13(invalid)), null);
});
