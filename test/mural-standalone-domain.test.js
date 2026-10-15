import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Mural subdomain and /mural deep-link mount their own app rather than the Scanner',()=>{
  const entry=read('src/entry.jsx');
  const standalone=read('src/mural-standalone.jsx');
  assert.match(entry,/hostname === 'mural\.sistemanistiid\.online'/);
  assert.match(entry,/pathname === '\/mural'/);
  assert.match(entry,/return 'mural'/);
  assert.match(entry,/import\('\.\/mural-standalone\.jsx'\)/);
  assert.match(standalone,/import MuralNisti from '\.\/mural-nisti\.jsx'/);
  assert.match(standalone,/<MuralNisti \/>/);
  assert.doesNotMatch(standalone,/GtinScannerOverlay|NotificationsModal|AdminApp/);
  assert.match(standalone,/api\/mural\/access/);
  assert.match(standalone,/payload\?\.released/);
});

test('Dedicated Mural hostname serves HTML and denies Scanner and admin APIs',()=>{
  const edge=read('src/edge-router.js');
  assert.match(edge,/url\.hostname === 'mural\.sistemanistiid\.online'/);
  assert.match(edge,/const muralApi = pathname === '\/api\/mural'/);
  assert.match(edge,/if \(!muralApi && !publicImage\)/);
  assert.match(edge,/pathname === '\/admin-login'/);
  assert.match(edge,/pathname === '\/admin-commerce'/);
  assert.match(edge,/pathname === '\/mural'/);
  assert.match(edge,/env\.ASSETS\.fetch\(new Request\(new URL\('\/',url\)/);
  assert.match(read('src/mural-router.js'),/MURAL_PUBLIC_RELEASED = true/);
});

test('Existing Scanner, administration, public push and PWA routes remain unchanged',()=>{
  const entry=read('src/entry.jsx');
  const sw=read('public/sw.js');
  const standalone=read('src/mural-standalone.jsx');
  assert.match(entry,/return 'public'/);
  assert.match(entry,/window\.location\.pathname === '\/admin'/);
  assert.match(entry,/import\('\.\/public-main\.jsx'\)/);
  assert.match(sw,/self\.addEventListener\('push'/);
  assert.match(sw,/showNotification\(title, options\)/);
  assert.match(standalone,/mural-viewport mural-standalone/);
});
