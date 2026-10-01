import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { __muralTransparentImageInternals } from '../src/mural-transparent-image.js';

const source = fs.readFileSync(new URL('../src/mural-transparent-image.js', import.meta.url), 'utf8');

test('background removal is conservative enough to protect white and off-white covers', () => {
  assert.match(source, /brightness >= 242 && chroma <= 18/);
  assert.match(source, /data\[offset \+ 3\] = 0/);
  assert.match(source, /productStats\.ratio < \.055/);
  assert.match(source, /productWidth < width \* \.25/);
  assert.match(source, /productHeight < height \* \.25/);
});

test('only images with real transparent borders skip background cleanup', () => {
  assert.match(source, /function hasExistingTransparency/);
  assert.match(source, /function hasUsableTransparentBorder/);
  assert.match(source, /transparent \/ sampled >= 0\.18/);
  assert.match(source, /hasExistingTransparency\(data, total\) && hasUsableTransparentBorder\(data, width, height\)/);
});

test('light cover artwork is protected by a solid linear convex silhouette', () => {
  assert.match(source, /function buildSubjectProtection/);
  assert.match(source, /function buildDominantForegroundGrid/);
  assert.match(source, /function convexHull/);
  assert.match(source, /return brightness < 218 \|\| chroma > 30/);
  assert.match(source, /dominant\.labels/);
  assert.match(source, /const expandedHull = hull\.map/);
  assert.match(source, /protectedMin\[y\]/);
  assert.match(source, /protectedMax\[y\]/);
  assert.match(source, /const subjectEvidence = buildSubjectProtection/);
});

test('unsafe mostly-white products keep their original source instead of being damaged', () => {
  assert.match(source, /if \(hull\.length < 3\) return null/);
  assert.match(source, /if \(!subjectEvidence\) return src/);
});

test('white agenda body between wire-o and elastic stays protected', () => {
  const width = 100;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255;
    data[index * 4 + 1] = 255;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }
  const paint = (fromX, toX, fromY, toY, color) => {
    for (let y = fromY; y <= toY; y += 1) {
      for (let x = fromX; x <= toX; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
      }
    }
  };

  paint(18, 24, 15, 85, [20, 20, 20]); // wire-o side
  paint(80, 84, 14, 87, [25, 25, 25]); // elastic side
  paint(22, 80, 34, 72, [225, 80, 120]); // cover artwork connects both edges

  const protect = __muralTransparentImageInternals.buildSubjectProtection(data, width, height);
  assert.ok(protect);
  assert.equal(protect(50, 50), true);
  assert.equal(protect(30, 50), true);
  assert.equal(protect(74, 50), true);
  assert.equal(protect(6, 50), false);
});


test('outline keeps the product and nearby detached wire-o while filling internal holes', () => {
  assert.match(source, /function buildProductComponentsMask/);
  assert.match(source, /const closeToMainProduct/);
  assert.match(source, /const anotherLargeProduct/);
  assert.match(source, /function fillMaskInteriorHoles/);
  assert.match(source, /if \(!mask\[index\] && !outside\[index\]\) solid\[index\] = 1/);
});

test('outline is only the external white ring and rejects background-sized masks', () => {
  assert.match(source, /function dilateMask/);
  assert.match(source, /function maskStats/);
  assert.match(source, /if \(stats\.ratio > \.82 \|\| stats\.touches >= 3\) return ''/);
  assert.match(source, /const radius = clamp\(Math\.round\(Math\.max\(width, height\) \* \.0028\), 2, 5\)/);
  assert.match(source, /const expandedMask = dilateMask\(solidMask, width, height, radius\)/);
  assert.match(source, /if \(!expandedMask\[index\] \|\| solidMask\[index\]\) continue/);
  assert.match(source, /outlineData\.data\[offset\] = 255/);
  assert.match(source, /export function useTransparentProductOutline/);
});

test('outline follows detached wire-o details but ignores an isolated corner logo', () => {
  const width = 120;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (fromX, toX, fromY, toY) => {
    for (let y = fromY; y <= toY; y += 1) {
      for (let x = fromX; x <= toX; x += 1) {
        data[(y * width + x) * 4 + 3] = 255;
      }
    }
  };

  paint(35, 94, 12, 91); // agenda body
  paint(29, 32, 24, 28); // detached wire-o near the agenda
  paint(29, 32, 42, 46);
  paint(4, 14, 4, 10); // detached logo in the corner

  const mask = __muralTransparentImageInternals.buildProductComponentsMask(data, width, height);
  assert.ok(mask);
  assert.equal(mask[50 * width + 60], 1);
  assert.equal(mask[26 * width + 30], 1);
  assert.equal(mask[7 * width + 8], 0);
});

test('detached corner logo cannot stretch the dominant agenda silhouette', () => {
  const width = 100;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255;
    data[index * 4 + 1] = 255;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }
  const paint = (fromX, toX, fromY, toY, color) => {
    for (let y = fromY; y <= toY; y += 1) {
      for (let x = fromX; x <= toX; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
      }
    }
  };

  paint(28, 76, 14, 88, [220, 80, 120]);
  paint(4, 10, 4, 10, [20, 20, 20]);
  const protect = __muralTransparentImageInternals.buildSubjectProtection(data, width, height);
  assert.ok(protect);
  assert.equal(protect(50, 50), true);
  assert.equal(protect(7, 7), false);

  __muralTransparentImageInternals.clearOutsideSubject(data, width, height, protect);
  assert.equal(data[(50 * width + 50) * 4 + 3], 255);
  assert.equal(data[(7 * width + 7) * 4 + 3], 0);
});


test('global treated product image bakes a clean 6–10px-equivalent white outline into transparent PNG', () => {
  assert.match(source, /async function buildTreatedProductImage/);
  assert.match(source, /8 \/ 1024/);
  assert.match(source, /const padding = outlineRadius \+ 2/);
  assert.match(source, /if \(!expandedMask\[sourceIndex\] \|\| solidMask\[sourceIndex\]\) continue/);
  assert.match(source, /outputContext\.drawImage\(sourceCanvas, padding, padding\)/);
  assert.match(source, /export function useTreatedProductImage/);
});

test('automatic cutout no longer hard-clips pixels to the convex hull plate', () => {
  const buildStart = source.indexOf('async function buildTransparentProductImage');
  const buildEnd = source.indexOf('export async function transparentProductImageUrl');
  const buildSource = source.slice(buildStart, buildEnd);
  assert.equal(buildSource.includes('clearOutsideSubject(data, width, height'), false);
  assert.match(buildSource, /const keepMask = dilateMask\(productMask, width, height, 1\)/);
});
