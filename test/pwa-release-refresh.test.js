import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');

test('service worker refreshes already-open clients after a release-gate deploy',()=>{
  assert.match(sw,/nisti-id-v32/);
  assert.match(sw,/clients\.matchAll\(\{ type: 'window', includeUncontrolled: true \}\)/);
  assert.match(sw,/client\.navigate\(client\.url\)/);
});
