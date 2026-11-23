import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FILE = 'supabase/migrations/20261123200000_commerce_shopee_reconciliation_v1.sql';
const read = (p) => fs.readFileSync(p, 'utf8');
const sql = fs.existsSync(FILE) ? read(FILE) : '';

test('GA-011: migração existe e define a função versionada de leitura', () => {
  assert.ok(sql.length > 0, 'migração da conciliação Shopee não existe');
  assert.match(sql, /create or replace function public\.commerce_shopee_reconciliation_v1\(\s*p_start date,\s*p_end date,\s*p_limit integer default 500\s*\)/i);
  assert.match(sql, /returns jsonb language plpgsql stable security invoker set search_path=public/i);
});

test('GA-011: acesso restrito ao service_role', () => {
  assert.match(sql, /revoke all on function public\.commerce_shopee_reconciliation_v1\(date,\s*date,\s*integer\) from public,\s*anon,\s*authenticated/i);
  assert.match(sql, /grant execute on function public\.commerce_shopee_reconciliation_v1\(date,\s*date,\s*integer\) to service_role/i);
});

test('GA-011: só lê; não altera view, ABC, importadores nem dados', () => {
  assert.doesNotMatch(sql, /\b(insert\s+into|update\s+public|delete\s+from|truncate|drop\s+(table|view|function)|alter\s+(table|view)|create\s+(or\s+replace\s+)?view|create\s+table)\b/i);
  assert.doesNotMatch(sql, /commerce_sales_abc|commerce_dashboard_abc|commerce_append_|commerce_commit_/i);
});

test('GA-011: fonte por SKU usa a mesma regra da view (snapshot mais recente por dia, receita arredondada)', () => {
  assert.match(sql, /commerce_shopee_sales_sku_daily_v1/);
  assert.match(sql, /b\.status\s*=\s*'COMMITTED'/);
  assert.match(sql, /max\(s\.snap\)|max\(snap\)/i);
  assert.match(sql, /round\(sum\(s\.product_revenue\),\s*2\)/i);
});

test('GA-011: base por anúncio lê a view oficial e os vínculos oficiais (antigos e atuais)', () => {
  assert.match(sql, /commerce_current_sales_listing_daily_v1/);
  assert.match(sql, /commerce_shopee_sku_owner_reviewed_v1/);
  assert.match(sql, /canonical_sku_norm/);
  assert.match(sql, /mapping_type/);
});

test('GA-011: devolve totais, diferença, SKUs sem vínculo, % conciliado e cobertura', () => {
  for (const k of ['totals', 'source', 'base', 'difference', 'unmatched_skus', 'skus', 'listings', 'listings_with_difference', 'reconciled_pct', 'coverage', 'status']) {
    assert.match(sql, new RegExp("'" + k + "'"), 'chave ausente: ' + k);
  }
});

test('GA-011: venda sem vínculo nunca é descartada (lista completa, sem limite)', () => {
  const m = sql.match(/'unmatched_skus'[\s\S]{0,800}?\)\s*,/);
  assert.ok(m, 'bloco unmatched_skus não encontrado');
  assert.doesNotMatch(m[0], /limit/i);
  assert.match(sql, /residual/i);
});

test('GA-011: ausência de dado não vira zero (SEM_DADOS, nulo e percentual com nullif)', () => {
  assert.match(sql, /'SEM_DADOS'/);
  assert.match(sql, /'PARCIAL'/);
  assert.match(sql, /'COMPLETO'/);
  assert.match(sql, /nullif\(/i);
  assert.match(sql, /then null/i);
  assert.match(sql, /missing_ranges/);
});

test('GA-011: valida o período e o limite', () => {
  assert.match(sql, /raise exception/i);
  assert.match(sql, /p_start is null or p_end is null/i);
  assert.match(sql, /p_start > p_end/i);
  assert.match(sql, /greatest\(1,\s*least\(coalesce\(p_limit,\s*500\),\s*2000\)\)/i);
});

test('GA-011: nenhum dado comercial real na migração (sem IDs longos, SKUs ou títulos)', () => {
  assert.doesNotMatch(sql, /\b\d{9,}\b/);
  assert.doesNotMatch(sql, /\bMLB\d+/);
});

test('GA-011: documentação técnica do GA descreve a função', () => {
  const mapa = read('docs/MAPA-GA.md');
  const nota = read('docs/cerebro/ga.md');
  assert.match(mapa, /commerce_shopee_reconciliation_v1/);
  assert.match(nota, /commerce_shopee_reconciliation_v1/);
});
