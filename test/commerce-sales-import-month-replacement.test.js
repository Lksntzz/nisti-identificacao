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

test('arquivos multipartes de vendas aguardam todas as partes e são consolidados juntos', () => {
  const migration = read('supabase/migrations/20261002110500_merge_multipart_sales_imports_v2.sql');

  assert.equal(migration.includes('WAITING_PARTS'), true);
  assert.equal(migration.includes('parts_received'), true);
  assert.equal(migration.includes('parts_expected'), true);
  assert.equal(migration.includes('missing_parts'), true);
  assert.equal(migration.includes('merged_parts'), true);
  assert.equal(migration.includes("b.status='STAGED'"), true);
  assert.equal(migration.includes('_part_[0-9]+_of_[0-9]+[.]xlsx
), true);
});

test('Central de Importações explica a regra de consolidação de partes', () => {
  const panel = read('src/commerce-sales-import-panel.jsx');
  const router = read('src/commerce-admin-router.js');

  assert.equal(panel.includes('substitui automaticamente qualquer versão parcial do mesmo mês e plataforma'), true);
  assert.equal(panel.includes('o sistema aguarda todas e consolida o mês automaticamente'), true);
  assert.equal(panel.includes('o sistema junta automaticamente'), true);
  assert.equal(panel.includes('WAITING_PARTS'), true);
  assert.equal(panel.includes('partes foram unidas automaticamente'), true);
  assert.equal(router.includes('sales_import_period_regression'), true);
});
