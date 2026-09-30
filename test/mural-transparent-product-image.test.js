import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/mural-transparent-image.js', import.meta.url), 'utf8');

test('background removal uses conservative white detection', () => {
  assert.match(source, /brightness >= 242 && chroma <= 18/);
  assert.match(source, /distance <= 8/);
  assert.match(source, /distance >= 38/);
});

test('existing transparent PNGs are never processed again', () => {
  assert.match(source, /function hasExistingTransparency/);
  assert.match(source, /if \(hasExistingTransparency\(data, total\)\) return src/);
});

test('light cover artwork is protected by the detected product silhouette', () => {
  assert.match(source, /function buildSubjectProtection/);
  assert.match(source, /const strongForeground = brightness < 235 \|\| chroma > 22/);
  assert.match(source, /return rowProtected && colProtected/);
  assert.match(source, /if \(!isProtectedSubjectPixel\(x, y\)\)/);
});
