import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../src/mural-nisti.css',import.meta.url),'utf8');

test('collection banner preserves the whole uploaded image',()=>{
  assert.ok(css.includes('/* Collection banner: preserve the complete uploaded artwork */'));
  assert.ok(css.includes('.mural-collection-detail.has-cover .mural-collection-editorial-media'));
  assert.ok(css.includes('height:auto;'));
  assert.ok(css.includes('object-fit:contain;'));
  assert.ok(css.includes('object-position:center;'));
  assert.ok(css.includes('transform:none;'));
});

test('collection information card no longer overlaps the banner',()=>{
  assert.ok(css.includes('.mural-collection-detail.has-cover .mural-collection-editorial-copy'));
  assert.ok(css.includes('margin:12px 14px 0;'));
  assert.ok(css.includes('margin:10px 12px 0;'));
});
