import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');

test('service worker activates without interrupting scans or unsaved forms',()=>{
  assert.match(sw,/nisti-id-v40/);
  assert.match(sw,/self\.clients\.claim\(\)/);
  assert.doesNotMatch(sw,/client\.navigate\(/);
});

test('offline HTML shell is restricted to public operator route',()=>{
  assert.match(sw,/url\.pathname === '\/' && response\.ok/);
  assert.match(sw,/if \(url\.pathname === '\/'\)/);
  assert.match(sw,/url\.pathname\.startsWith\('\/admin'\)/);
  assert.match(sw,/cache: 'no-store'/);
});


test('operator app registers the service worker and keeps push alive in background',()=>{
  const entry=fs.readFileSync(new URL('../src/entry.jsx',import.meta.url),'utf8');
  const publicApp=fs.readFileSync(new URL('../src/public-main.jsx',import.meta.url),'utf8');

  assert.match(entry,/navigator\.serviceWorker[\s\S]*?\.register\('\/sw\.js', \{ scope: '\/', updateViaCache: 'none' \}\)/);
  assert.match(publicApp,/syncExistingPushSubscription/);
  assert.match(publicApp,/persistPushSubscription\(subscription\)/);
  assert.doesNotMatch(publicApp,/if \(sub\) \{\s*await sub\.unsubscribe/);
  assert.match(sw,/pushsubscriptionchange/);
  assert.match(sw,/self\.registration\.pushManager\.subscribe/);
  assert.match(sw,/self\.registration\.showNotification/);
});

test('operator PWA exposes direct scanner and mural launch shortcuts',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
  const urls=manifest.shortcuts.map(item=>item.url);
  assert.deepEqual(urls,['/#scanner','/#mural']);
  assert.equal(manifest.display,'standalone');
  const app=fs.readFileSync(new URL('../src/public-main.jsx',import.meta.url),'utf8');
  assert.match(app,/handleHash\(\); \/\/ Honor PWA shortcut/);
});
