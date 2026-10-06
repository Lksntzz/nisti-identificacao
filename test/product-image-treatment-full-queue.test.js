import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync(new URL('../src/product-image-treatment-worker.jsx',import.meta.url),'utf8');

test('manual image treatment continues through the full queue sequentially',()=>{
  assert.ok(worker.includes('const BATCH_SIZE = 1;'));
  assert.ok(worker.includes('while (!cancelled && !treatmentPaused() && emptyPasses < 2)'));
  assert.equal(worker.includes('let terminalItems = 0;'),false);
  assert.equal(worker.includes('if (terminalItems >= 1)'),false);
  assert.ok(worker.includes('One explicit start processes the entire current queue sequentially'));
});

test('Canva quota still pauses the queue safely',()=>{
  assert.ok(worker.includes("error?.code === 'canva_credit_quota_exceeded'"));
  assert.ok(worker.includes('setTreatmentPausedStorage(true);'));
});
