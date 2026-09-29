import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

test('importação de vendas substitui o mês da plataforma e não apenas a chave exata do período', () => {
  const migration = read('supabase/migrations/20260929164000_replace_partial_sales_months.sql');

  assert.equal(migration.includes("date_trunc('month',period_start)::date as month_start"), true);
  assert.equal(migration.includes("p.month_start=date_trunc('month',r.period_start)::date"), true);
  assert.equal(migration.includes("p.month_start=date_trunc('month',s.period_start)::date"), true);
  assert.equal(migration.includes('sales_import_period_regression'), true);
  assert.equal(migration.includes("'replaced_months'"), true);
});

test('Central de Importações explica a regra de completar mês parcial', () => {
  const panel = read('src/commerce-sales-import-panel.jsx');
  const router = read('src/commerce-admin-router.js');

  assert.equal(panel.includes('substitui automaticamente qualquer versão parcial do mesmo mês e plataforma'), true);
  assert.equal(panel.includes('envie o arquivo do mês inteiro'), true);
  assert.equal(panel.includes('Mês(es) substituído(s)'), true);
  assert.equal(router.includes('sales_import_period_regression'), true);
});
