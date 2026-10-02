import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function jsFiles(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry => {
    const full=path.join(dir,entry.name);
    return entry.isDirectory() ? jsFiles(full) : entry.isFile() && /\.js$/.test(entry.name) ? [full] : [];
  });
}

const reviewed = new Set([
  'src/core-router.js',
  'src/product-finish-router.js',
  'src/recognition-metrics.js',
  'src/system-metrics-clean-router.js',
  'src/cover-notifications.js',
  'src/web-push.js',
  'src/geometric-shadow-evidence-router.js',
  'src/gtin-router.js',
  'src/geometric-shadow-confirmation-router.js',
  'src/legacy-model-budget.js',
  'src/mural-router.js'
]);
