import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/commerce-admin-app-v2.jsx','utf8');
const store = fs.readFileSync('src/commerce-supabase-store.js','utf8');
const sql = fs.readFileSync('supabase/migrations/20261015231000_catalog_active_listing_variations.sql','utf8');

test('variation association respects seller account and protects Scanner identity', () => {
  assert.match(sql,/b\.account_code is not distinct from l\.account_code/);
  assert.match(sql,/lp\.variation_id=s\.variation_id/);
  assert.match(sql,/left join lateral/);
  assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql,/insert into public\.products|update public\.products/i);
});
