import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { __muralTransparentImageInternals } from '../src/mural-transparent-image.js';

const source = fs.readFileSync(new URL('../src/mural-transparent-image.js', import.meta.url), 'utf8');

test('background removal includes pale halo only outside the protected product', () => {
  assert.match(source, /brightness >= 222 && chroma <= 28/);
  assert.match(source, /data\[offset \+ 3\] = 0/);
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
  assert.match(source, /if \(!isProtectedSubjectPixel\(x, y\)\)/);
});

test('unsafe mostly-white products keep their original source instead of being damaged', () => {
  assert.match(source, /if \(hull\.length < 3\) return null/);
  assert.match(source, /if \(!isProtectedSubjectPixel\) return src/);
});


test('outline uses only the largest connected product and fills internal holes', () => {
  assert.match(source, /function buildLargestConnectedSubjectMask/);
  assert.match(source, /if \(count > largestSize\)/);
  assert.match(source, /function fillMaskInteriorHoles/);
  assert.match(source, /if \(!mask\[index\] && !outside\[index\]\) solid\[index\] = 1/);
});

test('outline is only the external white ring and rejects background-sized masks', () => {
  assert.match(source, /function dilateMask/);
  assert.match(source, /function maskStats/);
  assert.match(source, /if \(stats\.ratio > \.82 \|\| stats\.touches >= 3\) return ''/);
  assert.match(source, /const radius = clamp\(Math\.round\(Math\.max\(width, height\) \* \.0018\), 1, 3\)/);
  assert.match(source, /const expandedMask = dilateMask\(solidMask, width, height, radius\)/);
  assert.match(source, /if \(!expandedMask\[index\] \|\| solidMask\[index\]\) continue/);
  assert.match(source, /outlineData\.data\[offset\] = 255/);
  assert.match(source, /export function useTransparentProductOutline/);
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
