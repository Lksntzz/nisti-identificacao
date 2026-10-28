import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deltaPct } from '../src/commerce-sales-breakdown-helpers.js';

const dash = readFileSync('src/commerce-dashboard.jsx', 'utf8');
const router = readFileSync('src/commerce-admin-router.js', 'utf8');
const store = readFileSync('src/commerce-supabase-store.js', 'utf8');
const sql = readFileSync('supabase/migrations/20261028100000_commerce_listing_sales_breakdown_v2.sql', 'utf8');

test('variacao percentual entre periodos', () => {
  assert.equal(deltaPct(257, 296), -13.2);
  assert.equal(deltaPct(41, 47), -12.8);
  assert.equal(deltaPct(5, 0), null);
});

const manager = readFileSync('src/commerce-ad-manager.jsx', 'utf8');

test('detalhe de vendas por semana, dia e mes mora no Painel Comercial, nao no Dashboard', () => {
  assert.doesNotMatch(dash, /WeeklySalesCell|DailySalesRow|MonthsPanelRow|useSalesBreakdown/);
  assert.doesNotMatch(dash, /<th>Por que caiu<\/th>/);
  assert.match(manager, /<WeeklySalesCell /);
  assert.match(manager, /<DailySalesRow /);
  assert.match(manager, /<MonthsPanelRow /);
  assert.match(manager, /useSalesMonths\(rows\)/);
  assert.match(manager, /Histórico de vendas/);
});

test('rota e funcao SQL de vendas por dia e semana validam entrada e sao somente leitura', () => {
  assert.match(router, /listings\/manager\/sales-breakdown/);
  assert.match(store, /commerce_listing_sales_breakdown_v2/);
  assert.match(sql, /language sql stable/);
  assert.match(sql, /revoke all on function public\.commerce_listing_sales_breakdown_v2\(bigint\[\],text\) from public,anon,authenticated/);
  assert.doesNotMatch(sql, /\b(insert into|update public|delete from)\b/i);
});

test('Painel Comercial usa ancora last_sale para anuncios sem vendas no periodo', () => {
  assert.match(manager, /useSalesBreakdown\(idleSaleRows,'last_sale'\)/);
  assert.match(manager, /anchored=\{!\(Number\(item\.units\)>0\)\}/);
  assert.match(router, /anchor/);
  assert.match(sql, /p_anchor='last_sale'/);
});

test('Dashboard: 4 indices de performance no lugar dos cards de faturamento', () => {
  for (const l of ['Vendendo', 'Em queda', 'Vendia e parou', 'Não vendeu']) assert.match(dash, new RegExp('label="' + l + '"'));
  assert.doesNotMatch(dash, /label="Faturamento total"|label="Investimento em anúncios"|label="ROAS dos anúncios"/);
});

test('Dashboard: grafico mostra faturamento por produto conforme o filtro', () => {
  assert.match(dash, /<RevenueByProduct items=\{top\}\/>/);
  assert.match(dash, /title="Faturamento por produto"/);
  assert.doesNotMatch(dash, /<DailyChart|<MonthlyChart|segment-series/);
});
