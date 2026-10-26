import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL('../'+f, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261026140000_commerce_listing_price_signal_v1.sql');
const router = read('src/commerce-admin-router.js');
const store = read('src/commerce-supabase-store.js');
const ui = read('src/commerce-ad-manager.jsx');
const cell = read('src/commerce-price-signal.jsx');

test('price signal SQL is read-only and service_role only', () => {
  assert.match(sql, /language sql stable/);
  assert.doesNotMatch(sql, /\b(insert into|update public|delete from)\b/i);
  assert.match(sql, /revoke all on function public\.commerce_listing_price_signal_v1/);
  assert.match(sql, /grant execute[\s\S]*to service_role/);
  assert.match(sql, /<=200/);
});

test('route validates ids and period and calls the store', () => {
  assert.ok(router.includes("/listings/manager/price-signal"));
  assert.ok(router.includes('ids.length>200'));
  assert.ok(router.includes('commerceListingPriceSignal(env,{ids,days})'));
  assert.ok(store.includes("'commerce_listing_price_signal_v1'"));
});

test('ad table shows the Preço × vendas column and never claims causation', () => {
  assert.ok(ui.includes('Preço × vendas'));
  assert.ok(ui.includes('<PriceSignalCell'));
  assert.match(cell, /não prova de causa|nao prova de causa/i);
  for (const key of ['PRICE_UP_SALES_DOWN','DROP_PRICE_STABLE','INSUFFICIENT']) assert.ok(cell.includes(key));
});
