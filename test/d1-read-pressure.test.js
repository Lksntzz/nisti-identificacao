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

test('catalog list no longer executes D1 SQL after the Supabase runtime cutover', () => {
  const core=read('src/core-router.js');
  assert.match(core,/supabaseReserveProducts\(env\)/);
  assert.doesNotMatch(core,/WITH first_platform_id AS/);
  assert.doesNotMatch(core,/env\.DB/);
});

test('product mutations wake the treatment worker without short idle polling', () => {
  const main=read('src/main.jsx');
  const worker=read('src/product-image-treatment-worker.jsx');
  assert.match(main,/TREATMENT_WAKE_EVENT/);
  assert.match(main,/window\.dispatchEvent\(new CustomEvent\(TREATMENT_WAKE_EVENT\)\)/);
  assert.match(worker,/window\.addEventListener\(TREATMENT_WAKE_EVENT, onWake\)/);
});
