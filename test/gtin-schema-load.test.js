import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('GTIN schema migration and operational load remain separated and locked to 220 approved links', () => {
  const manifest = JSON.parse(fs.readFileSync('data/gtin/product_gtins_v1.json', 'utf8'));
  const d1Schema = fs.readFileSync('migrations/0015_product_gtins.sql', 'utf8');
  const d1Load = fs.readFileSync('data/gtin/load_product_gtins_d1_v1.sql', 'utf8');
  assert.equal(manifest.records.length, 220);
  assert.match(d1Schema, /gtin TEXT NOT NULL UNIQUE/);
  assert.match(d1Schema, /FOREIGN KEY \(product_id\) REFERENCES products\(id\) ON DELETE CASCADE/);
  assert.equal((d1Load.match(/^\s*\(\d+, '\d{13}'/gm) || []).length, 220);
  assert.equal(fs.existsSync('migrations/0016_product_gtins_seed_v1.sql'), false);
  assert.equal(fs.existsSync('supabase/migrations/202609142010_nisti_gtin_gs1_seed_v1.sql'), false);
});

test('Supabase GTIN schema is service-role only and uses invoker RPC', () => {
  const sql = fs.readFileSync('supabase/migrations/202609142000_nisti_gtin_gs1_v1.sql', 'utf8');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.product_gtins FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.doesNotMatch(sql, /SECURITY DEFINER/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.nisti_product_by_gtin\(TEXT, TEXT\) TO service_role/);
});

test('runtime configuration keeps Supabase reads disabled', () => {
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
  assert.match(wrangler, /SUPABASE_READS_ENABLED\s*=\s*"0"/);
});
