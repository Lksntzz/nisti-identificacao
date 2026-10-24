import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('API e banco usam a base normalizada de vendas', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  const schema = read('supabase/migrations/20260928203447_commerce_sales_tables_v1.sql');
  const rpc = read('supabase/migrations/20260928203528_commerce_sales_dashboard_rpc_v1.sql');

  assert.equal(router.includes('/sales/dashboard'), true);
  assert.equal(store.includes('commerce_sales_dashboard_v1'), true);
  assert.equal(schema.includes('commerce_sales_rows'), true);
  assert.equal(schema.includes('commerce_sales_summary_rows'), true);
  assert.equal(rpc.includes('items_without_sales'), true);
  assert.equal(rpc.includes('listings_with_sales'), true);
  assert.equal(rpc.includes('ML_NOVO_GESTAO'), true);
  assert.equal(rpc.includes('ML_ANTIGO_GESTAO'), true);
});


test('Painel de Vendas consolida períodos pelo mês-calendário', () => {
  const migration = read('supabase/migrations/20261002111500_sales_dashboard_calendar_months_v2.sql');

  assert.equal(migration.includes("to_char(min(sr.period_start),'YYYY-MM') as period_key"), true);
  assert.equal(migration.includes("group by date_trunc('month',sr.period_start)"), true);
  assert.equal(migration.includes("to_char(sf.period_start,'YYYY-MM') as period_key"), true);
  assert.equal(migration.includes("group by date_trunc('month',s.period_start)"), true);
});
