import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../src/public-main.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-nisti.css',import.meta.url),'utf8');

test('Scanner Mural call-to-action is colorful with a separate coming-soon marker',()=>{
  assert.match(src,/mural-nav-btn-spotlight/);
  assert.match(src,/mural-nav-teaser/);
  assert.match(src,/NOVO/);
  assert.match(css,/linear-gradient\(120deg,#6d28d9/);
  assert.match(css,/\.mural-nav-teaser/);
});

test('Teaser is not represented as a real unread counter before Mural release',()=>{
  assert.match(src,/muralReleased \? '' : ' is-coming-soon'/);
  assert.match(src,/!muralReleased \? <span className="mural-nav-teaser"/);
  assert.match(src,/setMuralReleaseConfirmed\(Boolean\(data\?\.released\)\)/);
});

test('Operator Mural stays locked on denied API access and public QA bypass is removed',()=>{
  assert.match(src,/setMuralAccess\(false\)/);
  assert.doesNotMatch(src,/setMuralAccess\(true\)/);
  assert.doesNotMatch(src,/Abrir Demonstração do Mural \(QA\)/);
  assert.match(src,/muralAccess \? \(/);
  assert.match(src,/mural-coming-soon/);
});
