import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const view = fs.readFileSync(new URL('../src/admin/BarcodeGeneratorView.jsx', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../supabase/migrations/20261001260000_primary_gtin_registry_reads_v1.sql', import.meta.url), 'utf8');

test('gerador avisa quando a lista de EANs chega ao limite da consulta', () => {
  assert.match(view, /const GTIN_REGISTRY_LIMIT = 2000;/);
  assert.match(sql, /LIMIT 2000/);
  assert.match(view, /registryLimitReached && \(/);
});
