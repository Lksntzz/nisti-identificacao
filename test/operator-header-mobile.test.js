import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css=fs.readFileSync(new URL('../src/app.css',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');

test('mobile operator header allocates separate brand and action columns',()=>{
  assert.match(css,/grid-template-columns:minmax\(112px,1fr\) auto/);
  assert.match(css,/\.ean-viewport \.brand-identity\s*\{[^}]*min-width:0/);
  assert.match(css,/\.ean-viewport \.brand-main-title\s*\{[^}]*max-width:100%;[^}]*overflow:hidden/);
  assert.match(css,/\.ean-viewport \.header-actions\s*\{[^}]*min-width:0/);
  assert.match(css,/\.ean-viewport \.operator-profile-pill\s*\{[^}]*max-width:96px/);
});


test('mobile header hotfix forces clients onto the refreshed asset cache',()=>{
  assert.match(sw,/CACHE_NAME = 'nisti-id-v33'/);
});
