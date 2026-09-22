import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const migrationPath = 'supabase/migrations/202609221520_commerce_new_product_suggestions_v1.sql';

test('produto novo recebe apenas sugestão humana, nunca vínculo automático', () => {
  const sql = read(migrationPath);
  assert.equal(sql.includes('commerce_suggest_new_product_candidates_v1'), true);
  assert.equal(sql.includes("status = 'PROBABLE'"), true);
  assert.equal(sql.includes("match_method = 'SUGGESTED_EXISTING'"), true);
  assert.equal(sql.includes('existing_product_suggestion_requires_review'), true);
  assert.equal(sql.includes("set\n        status = 'MATCHED'"), false);
});

test('heurística usa família de SKU sem ano e sinais de nome conservadores', () => {
  const sql = read(migrationPath);
  assert.equal(sql.includes('commerce_sku_yearless_family_key_v1'), true);
  assert.equal(sql.includes('commerce_name_signal_tokens_v1'), true);
  assert.equal(sql.includes("'SKU_YEARLESS_FAMILY'"), true);
  assert.equal(sql.includes("'NAME_SIGNAL_SKU_HINT'"), true);
  assert.equal(sql.includes("'NAME_SIGNAL_EXACT'"), true);
  assert.equal(sql.includes("'NAME_SIGNAL_STRONG'"), true);
  assert.equal(sql.includes("'NAME_SIGNAL_SIMILAR'"), true);
  assert.equal(sql.includes('>= 0.45'), true);
});

test('quando há família de SKU inequívoca ela suprime candidatos só por nome', () => {
  const sql = read(migrationPath);
  assert.equal(sql.includes('not exists(select 1 from scored x where x.sku_family_exact)'), true);
  assert.equal(sql.includes('or s.sku_family_exact'), true);
  assert.equal(sql.includes('where rank <= 5'), true);
});

test('reconciliação administrativa usa a v5 com passe de sugestões', () => {
  const store = read('src/commerce-supabase-store.js');
  assert.equal(store.includes("'commerce_reconcile_import_batch_v5'"), true);
});

test('RPCs de sugestão são clonadas no sandbox e restritas à service role', () => {
  const sql = read(migrationPath);
  assert.equal(sql.includes('commerce_preview_suggest_new_product_candidates_v1'), true);
  assert.equal(sql.includes('commerce_preview_reconcile_import_batch_v5'), true);
  assert.equal(sql.includes('from public, anon, authenticated'), true);
  assert.equal(sql.includes('to service_role'), true);
});
