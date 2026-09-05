import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildFinalReplaceSql } from '../scripts/build-supabase-final-replace.mjs';

function sampleConvertedSql(extra = '') {
  return [
    '-- generated fixture',
    'BEGIN;',
    "SET LOCAL statement_timeout = '5min';",
    'INSERT INTO "products" ("id","sku","miolo_code","capa_code","acabamento_code","wireo_code","tassel_code","elastico_code","created_at","updated_at") VALUES (1,\'SKU\',\'M\',\'C\',\'A\',\'W\',\'T\',\'E\',\'2026-09-05T00:00:00Z\',\'2026-09-05T00:00:00Z\');',
    extra,
    'COMMIT;'
  ].filter(Boolean).join('\n');
}

test('Phase 6E final replace is one transaction, exact-table and non-cascading', () => {
  const { sql, statementCounts } = buildFinalReplaceSql(sampleConvertedSql());

  assert.equal(statementCounts.products, 1);
  assert.equal(statementCounts.product_platforms, 0);
  assert.match(sql, /^-- NISTI ID — FINAL CUTOVER REPLACE/m);
  assert.equal((sql.match(/\bBEGIN;/g) || []).length, 1);
  assert.equal((sql.match(/\bCOMMIT;/g) || []).length, 1);
  assert.match(sql, /TRUNCATE TABLE[\s\S]*public\."products"[\s\S]*public\."geometric_shadow_evidence"[\s\S]*RESTART IDENTITY;/);
  assert.doesNotMatch(sql, /\bCASCADE\b(?=\s*;)/i);
  assert.ok(sql.indexOf('TRUNCATE TABLE') < sql.indexOf('INSERT INTO "products"'));
  assert.match(sql, /pg_get_serial_sequence\('public\.scan_occurrences', 'id'\)/);
});

test('Phase 6E final replace rejects non-snapshot SQL instead of executing it', () => {
  assert.throws(
    () => buildFinalReplaceSql(sampleConvertedSql('UPDATE products SET sku=\'X\' WHERE id=1;')),
    /instrução inesperada/i
  );
  assert.throws(
    () => buildFinalReplaceSql(sampleConvertedSql('INSERT INTO unknown_table (id) VALUES (1);')),
    /tabela não autoritativa/i
  );
});

test('Phase 6E cutover freeze blocks mutating API requests before routers execute', () => {
  const source = fs.readFileSync('src/operator-audit-router.js', 'utf8');
  const freezeGuard = source.indexOf('if (isMutatingApiRequest(url, request))');
  const shadowRouter = source.indexOf('handleGeometricShadowConfirmationRequest(request, env)');
  const downstream = source.indexOf('const response = await app.fetch(request, env, ctx)');

  assert.ok(freezeGuard >= 0);
  assert.ok(shadowRouter > freezeGuard);
  assert.ok(downstream > freezeGuard);
  assert.match(source, /SUPABASE_CUTOVER_WRITE_FREEZE/);
  assert.match(source, /cutover_write_freeze_invalid_config/);
  assert.match(source, /retry-after/);
});

test('Phase 6E remains completely inactive by default', () => {
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
  assert.match(wrangler, /SUPABASE_WRITE_MODE\s*=\s*"off"/);
  assert.match(wrangler, /SUPABASE_READS_ENABLED\s*=\s*"0"/);
  assert.match(wrangler, /SUPABASE_CUTOVER_WRITE_FREEZE\s*=\s*"0"/);
});
