import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css=fs.readFileSync(new URL('../src/app.css',import.meta.url),'utf8');

test('mobile operator header allocates separate brand and action columns',()=>{
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css,/\.ean-viewport \.brand-identity \{ min-width:0/);
  assert.match(css,/\.ean-viewport \.brand-main-title \{ max-width:100%; overflow:hidden/);
  assert.match(css,/\.ean-viewport \.header-actions \{ min-width:0/);
  assert.match(css,/\.ean-viewport \.operator-profile-pill \{ max-width:126px/);
});
