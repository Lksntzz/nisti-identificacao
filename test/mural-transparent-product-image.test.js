import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/mural-transparent-image.js', import.meta.url), 'utf8');

test('background removal includes pale halo only outside the protected product', () => {
  assert.match(source, /brightness >= 222 && chroma <= 28/);
  assert.match(source, /data\[offset \+ 3\] = 0/);
});

test('existing transparent PNGs are never processed again', () => {
  assert.match(source, /function hasExistingTransparency/);
  assert.match(source, /if \(hasExistingTransparency\(data, total\)\) return src/);
});

test('light cover artwork is protected by a solid linear convex silhouette', () => {
  assert.match(source, /function buildSubjectProtection/);
  assert.match(source, /function convexHull/);
  assert.match(source, /const strongForeground = brightness < 235 \|\| chroma > 22/);
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

test('outline is a separately dilated solid white silhouette', () => {
  assert.match(source, /function dilateMask/);
  assert.match(source, /const outlineMask = dilateMask\(solidMask, width, height, radius\)/);
  assert.match(source, /outlineData\.data\[offset\] = 255/);
  assert.match(source, /export function useTransparentProductOutline/);
});
