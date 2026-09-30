import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');

test('admin exposes automated Mural release-readiness diagnostics', () => {
  assert.match(router, /const MURAL_IMAGE_BUDGETS = Object\.freeze/);
  assert.match(router, /first_fold:\s*Math\.round\(1\.5 \* 1024 \* 1024\)/);
  assert.match(router, /SELECT name FROM sqlite_master WHERE type='table'/);
  assert.match(router, /env\.PRODUCT_IMAGES\?\.head/);
  assert.match(router, /automated_ready:migrationOk && contentOk && imagesOk/);
  assert.match(router, /path === '\/api\/admin\/mural\/readiness'/);
});

test('readiness UI keeps real-device smoke tests explicit', () => {
  assert.match(admin, /request\('\/api\/admin\/mural\/readiness'\)/);
  assert.match(admin, /QA de liberação/);
  assert.match(admin, /MIGRATION D1/);
  assert.match(admin, /PRIMEIRA DOBRA/);
  assert.match(admin, /Scanner → Mural → Scanner/);
  assert.match(css, /\.mural-admin-readiness/);
});
