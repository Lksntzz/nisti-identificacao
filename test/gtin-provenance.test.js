import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('GTIN load records immutable source workbook provenance', () => {
  const manifest = JSON.parse(fs.readFileSync('data/gtin/product_gtins_v1.json', 'utf8'));
  const provenance = JSON.parse(fs.readFileSync('data/gtin/source_provenance_v1.json', 'utf8'));

  assert.equal(provenance.version, manifest.version);
  assert.equal(provenance.canonical_source_file, 'reconciliacao_gs1_nisti_fechada.xlsx');
  assert.equal(provenance.canonical_source_sha256, 'c2160914f7dc32ff1e743f16b41de9f99bc10052334d4f83e1f57832e38b2ce3');
  assert.equal(provenance.reconciliation_workbook, manifest.source_file);
  assert.equal(provenance.reconciliation_workbook_sha256, 'fb186523fb2786e678422a0683ed0297eec1c31d988abf8294cd1c9f268785f5');
});

test('Supabase validation covers product_gtins identity range', () => {
  const source = fs.readFileSync('supabase/sql/validate_d1_import.sql', 'utf8');
  assert.match(source, /UNION ALL SELECT 'product_gtins', MIN\(id\), MAX\(id\) FROM public\.product_gtins/);
});
