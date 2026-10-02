import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');

test('service worker refreshes already-open clients after a release-gate deploy',()=>{
  assert.match(sw,/nisti-id-v38/);
  assert.match(sw,/clients\.matchAll\(\{ type: 'window', includeUncontrolled: true \}\)/);
  assert.match(sw,/client\.navigate\(client\.url\)/);
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
