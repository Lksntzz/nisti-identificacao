import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('iPhone cached images recover when WebKit misses load or resumes offline',()=>{
  const jsx=read('src/mural-nisti.jsx');
  assert.match(jsx,/image\?\.complete && image\.naturalWidth > 0/);
  assert.match(jsx,/document\.addEventListener\('visibilitychange', recover\)/);
  assert.match(jsx,/window\.addEventListener\('online', recover\)/);
  assert.match(jsx,/setAttempt\(value => value \+ 1\)/);
  assert.match(jsx,/window\.clearTimeout\(timeout\)/);
  assert.match(jsx,/key=\{attempt\}/);
  assert.match(jsx,/onError=\{\(\) => \{[\s\S]*?setFailed\(true\)/);
});

test('all collection banners provide visible text while images are delayed',()=>{
  const jsx=read('src/mural-nisti.jsx');
  const css=read('src/mural-nisti.css');
  assert.match(jsx,/className="mural-launch-banner-fallback"/);
  assert.match(jsx,/onMediaReady=\{setBannerReady\}/g);
  assert.match(jsx,/bannerReady \? ' is-image-ready' : ''/g);
  assert.match(css,/\.mural-launch-hero\.has-banner\.is-image-ready \.mural-launch-banner-fallback \{display:none\}/);
  assert.match(css,/\.mural-collection-launch-card\.has-editorial-banner:not\(\.is-image-ready\) \.mural-collection-launch-copy/);
  assert.match(css,/\.mural-shell \.mural-image-media\.is-loaded \{[\s\S]*?opacity:1;/);
  assert.doesNotMatch(css.slice(css.lastIndexOf('iOS PWA recovery')),/opacity:0/);
});

test('the fallback does not change public Mural access, push or collection interaction',()=>{
  const jsx=read('src/mural-nisti.jsx');
  const router=read('src/mural-router.js');
  assert.match(jsx,/onClick=\{\(\) => onOpen\?\.\(item\)\}/);
  assert.match(jsx,/muralApi\(\x60\/api\/mural\?/);
  assert.match(router,/const MURAL_PUBLIC_RELEASED = true/);
});
