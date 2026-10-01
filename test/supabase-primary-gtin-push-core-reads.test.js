import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('src/core-router.js','utf8');
const gtin=fs.readFileSync('src/gtin-router.js','utf8');
const mirror=fs.readFileSync('src/supabase-mutation-mirror.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261001260000_primary_gtin_registry_reads_v1.sql','utf8');

test('GTIN registry and product GTIN reads use Supabase when enabled',()=>{
  assert.match(gtin,/nisti_gtin_registry_v1/);
  assert.match(gtin,/supabaseReserveProductGtins/);
  assert.match(gtin,/supabaseProductImageContext/);
  assert.match(gtin,/supabaseReadsRequested\(env\)/);
});

test('GTIN registry RPC is invoker-only and service-role-only',()=>{
  assert.doesNotMatch(sql,/SECURITY DEFINER/i);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.nisti_gtin_registry_v1\(\)/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.nisti_gtin_registry_v1\(\)/);
});

test('core image and push diagnostics prefer Supabase reads',()=>{
  const imageBlock=core.slice(
    core.indexOf("const imageGet ="),
    core.indexOf("/api/admin/product-image-treatment/summary")
  );
  assert.match(imageBlock,/supabaseReadsRequested\(env\)/);
  assert.match(core,/nisti_list_push_subscriptions_v1/);
});

test('test notification is a direct primary mutation and does not require D1 remirroring',()=>{
  assert.match(core,/recordNewCoverNotification\(env/);
  assert.match(mirror,/url\.pathname === '\/api\/admin\/notifications\/test'/);
});

test('Mural read receipts do not remirror from D1 in primary mode',()=>{
  assert.match(mirror,/\/api\\\/mural\\\/\\d\+\\\/read/);
  assert.match(mirror,/\/api\/mural\/mark-all-read/);
});
