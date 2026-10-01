import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path,'utf8');

test('admin background metrics refresh is five minutes and only runs while visible', () => {
  const main=read('src/main.jsx');
  assert.match(main,/setInterval\(refreshMetricsIfVisible, 5 \* 60 \* 1000\)/);
  assert.match(main,/document\.visibilityState === 'visible'/);
  assert.doesNotMatch(main,/setInterval\(refreshMetrics, 30000\)/);
});

test('system health cache matches the reduced five-minute cadence', () => {
  const metrics=read('src/system-metrics-clean-router.js');
  assert.match(metrics,/SYSTEM_HEALTH_CACHE_TTL_MS = 5 \* 60 \* 1000/);
});

test('catalog list aggregates platform and GTIN relations once instead of correlated N+1 subqueries', () => {
  const core=read('src/core-router.js');
  assert.match(core,/WITH first_platform_id AS/);
  assert.match(core,/first_gtin_id AS/);
  assert.match(core,/LEFT JOIN first_platform fp ON fp\.product_id=p\.id/);
  assert.match(core,/LEFT JOIN first_gtin fg ON fg\.product_id=p\.id/);
  assert.doesNotMatch(core,/\(SELECT pp\.platform FROM product_platforms pp WHERE pp\.product_id=p\.id ORDER BY pp\.id ASC LIMIT 1\)/);
});

test('product mutations wake the treatment worker without short idle polling', () => {
  const main=read('src/main.jsx');
  const worker=read('src/product-image-treatment-worker.jsx');
  assert.match(main,/TREATMENT_WAKE_EVENT/);
  assert.match(main,/window\.dispatchEvent\(new CustomEvent\(TREATMENT_WAKE_EVENT\)\)/);
  assert.match(worker,/window\.addEventListener\(TREATMENT_WAKE_EVENT, onWake\)/);
});
