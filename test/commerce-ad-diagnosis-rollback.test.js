import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('commercial navigation is restored after removing unified view', () => {
  const ui = fs.readFileSync('src/commerce-ad-manager.jsx', 'utf8');
  assert.ok(ui.includes("useState('LISTINGS')"));
  assert.ok(ui.includes('CommerceSalesEvolution'));
  assert.ok(ui.includes('ListingDiagnosisPanel'));
  assert.ok(!ui.includes('CommerceAdDiagnosisWorkspace'));
});

test('rejected dashboard files and routes are absent', () => {
  for (const path of ['src/commerce-ad-diagnosis-workspace.jsx', 'src/commerce-ad-diagnosis-workspace.css', 'src/commerce-ad-diagnosis-model.js']) {
    assert.equal(fs.existsSync(path), false);
  }
  const router = fs.readFileSync('src/commerce-admin-router.js', 'utf8');
  const store = fs.readFileSync('src/commerce-supabase-store.js', 'utf8');
  assert.ok(!router.includes('listingDailyPath'));
  assert.ok(!store.includes('commerceListingDiagnosisDaily'));
});
