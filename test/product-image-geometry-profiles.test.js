import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { __muralTransparentImageInternals } from '../src/mural-transparent-image.js';

const source = fs.readFileSync(new URL('../src/mural-transparent-image.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/product-image-treatment-worker.jsx', import.meta.url), 'utf8');

function fixture(width = 160, height = 160) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 252;
    data[index * 4 + 1] = 252;
    data[index * 4 + 2] = 252;
    data[index * 4 + 3] = 255;
  }
  const paint = (x0, y0, x1, y1, color = [30,30,30]) => {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
      }
    }
  };
  return { data, width, height, paint };
}

test('disc notebook SKU overrides square-canvas MKP selection', () => {
  const f = fixture();
  f.paint(50, 18, 108, 142, [120,80,45]);
  const result = __muralTransparentImageInternals.classifyProductGeometry(
    f.data, f.width, f.height, { sku:'CDISC_CRM1_PXP', name:'Caderno de Discos' }
  );
  assert.equal(result.kind, 'disc');

  const renamed = __muralTransparentImageInternals.classifyProductGeometry(
    f.data, f.width, f.height, { sku:'CADISC_CRM1_PXP' }
  );
  assert.equal(renamed.kind, 'disc');
});

test('landscape product is classified as horizontal instead of standard vertical planner', () => {
  const f = fixture(220, 160);
  f.paint(20, 48, 200, 112, [25,25,25]);
  const result = __muralTransparentImageInternals.classifyProductGeometry(
    f.data, f.width, f.height, {}
  );
  assert.equal(result.kind, 'horizontal');
  assert.ok(result.metrics.aspect > 1.04);
  assert.ok(result.metrics.axisTilt < 12);
});

test('tilted product is classified as perspective', () => {
  const f = fixture(180, 180);
  // Thick diagonal band approximates a notebook photographed in perspective.
  for (let x = 24; x <= 150; x += 1) {
    const centerY = Math.round(42 + (x - 24) * 0.48);
    f.paint(x, Math.max(8, centerY - 24), x, Math.min(171, centerY + 24), [45,45,45]);
  }
  const result = __muralTransparentImageInternals.classifyProductGeometry(
    f.data, f.width, f.height, {}
  );
  assert.equal(result.kind, 'perspective');
  assert.ok(result.metrics.axisTilt >= 12);
});

test('upright product remains on the standard planner profile', () => {
  const f = fixture();
  f.paint(48, 18, 108, 142, [35,35,35]);
  const result = __muralTransparentImageInternals.classifyProductGeometry(
    f.data, f.width, f.height, {}
  );
  assert.equal(result.kind, 'standard');
});

test('horizontal and disc profiles protect a white product core with distinct geometry', () => {
  const horizontal = fixture(220, 180);
  horizontal.paint(18, 55, 202, 120, [30,30,30]);
  const horizontalProtect = __muralTransparentImageInternals.buildHorizontalStructureProtection(
    horizontal.data, horizontal.width, horizontal.height, true
  );
  assert.ok(horizontalProtect);
  assert.equal(horizontalProtect(110, 90), true);
  assert.equal(horizontalProtect(4, 90), false);

  const disc = fixture(180, 220);
  disc.paint(38, 24, 135, 198, [55,55,55]);
  const discProtect = __muralTransparentImageInternals.buildDiscStructureProtection(
    disc.data, disc.width, disc.height, true
  );
  assert.ok(discProtect);
  assert.equal(discProtect(90, 110), true);
  assert.equal(discProtect(4, 110), false);
});

test('legacy square MKP mask is restricted to standard geometry', () => {
  assert.match(source, /const standardMkpEligible = geometry\.kind === 'standard'/);
  assert.match(source, /square canvas alone is no longer enough/);
  assert.match(source, /geometry\.kind === 'horizontal'/);
  assert.match(source, /geometry\.kind === 'perspective'/);
  assert.match(source, /geometry\.kind === 'disc'/);
});

test('worker supplies SKU and name so disc families are recognized during treatment and mask backfill', () => {
  assert.ok((worker.match(/sku:item\.sku/g) || []).length >= 2);
  assert.ok((worker.match(/name:item\.name/g) || []).length >= 2);
  assert.ok(worker.includes('requireMkpMask:true'));
});
