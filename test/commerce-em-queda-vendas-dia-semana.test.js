import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deltaPct } from '../src/commerce-sales-breakdown-helpers.js';

const dash = readFileSync('src/commerce-dashboard.jsx', 'utf8');
const router = readFileSync('src/commerce-admin-router.js', 'utf8');
const store = readFileSync('src/commerce-supabase-store.js', 'utf8');
const sql = readFileSync('supabase/migrations/20261027190000_commerce_listing_sales_breakdown_v1.sql', 'utf8');

test('variacao percentual entre periodos', () => {
  assert.equal(deltaPct(257, 296), -13.2);
  assert.equal(deltaPct(41, 47), -12.8);
  assert.equal(deltaPct(5, 0), null);
});

test('aba Em queda mostra vendas por semana e por dia no lugar de "Por que caiu"', () => {
  assert.match(dash, /<th>Vendas por semana e por dia<\/th>/);
  assert.doesNotMatch(dash, /<th>Por que caiu<\/th>/);
  assert.doesNotMatch(dash, /function reasonFor/);
  assert.match(dash, /<WeeklySalesCell /);
  assert.match(dash, /<DailySalesRow /);
});

test('rota e funcao SQL de vendas por dia e semana validam entrada e sao somente leitura', () => {
  assert.match(router, /listings\/manager\/sales-breakdown/);
  assert.match(store, /commerce_listing_sales_breakdown_v1/);
  assert.match(sql, /language sql stable/);
  assert.match(sql, /revoke all on function public\.commerce_listing_sales_breakdown_v1\(bigint\[\]\) from public,anon,authenticated/);
  assert.doesNotMatch(sql, /\b(insert into|update public|delete from)\b/i);
});
