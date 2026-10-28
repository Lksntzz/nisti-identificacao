import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bestMonth, monthLabel } from '../src/commerce-sales-breakdown-helpers.js';

test('monthLabel formata mes/ano', () => {
  assert.equal(monthLabel('2026-09'), 'set/26');
  assert.equal(monthLabel('2026-01'), 'jan/26');
});

test('bestMonth escolhe o mes com mais unidades e marca mes em andamento', () => {
  const months = [{ month: '2026-08', units: 1047 }, { month: '2026-09', units: 1186 }, { month: '2026-10', units: 962 }];
  const b = bestMonth(months, '2026-10-26');
  assert.equal(b.month, '2026-09');
  assert.ok(!b.ongoing);
  const c = bestMonth([{ month: '2026-09', units: 10 }, { month: '2026-10', units: 50 }], '2026-10-26');
  assert.equal(c.month, '2026-10');
  assert.ok(c.ongoing);
});

test('rota e SQL de vendas por mes sao somente leitura e restritos ao service_role', () => {
  const sql = fs.readFileSync('supabase/migrations/20261028120000_commerce_listing_sales_months_v1.sql', 'utf8');
  assert.match(sql, /stable/i);
  assert.match(sql, /revoke all on function[^;]*from public,\s*anon,\s*authenticated/i);
  assert.doesNotMatch(sql, /\b(insert into|update public|delete from)\b/i);
  const router = fs.readFileSync('src/commerce-admin-router.js', 'utf8');
  assert.match(router, /listings\/manager\/sales-months/);
});

test('dashboard mostra selo de mes mais vendido e painel de meses', () => {
  const dash = fs.readFileSync('src/commerce-dashboard.jsx', 'utf8');
  assert.match(dash, /MonthsPanelRow/);
  assert.match(dash, /useSalesMonths/);
  const comp = fs.readFileSync('src/commerce-sales-breakdown.jsx', 'utf8');
  assert.match(comp, /Mais vendido/);
});
