import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncNistiProductsToCommerce } from '../src/nisti-commerce-sync.js';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('empty Commerce import skips sync before ever reading or writing Scanner products', async()=>{
  const before=globalThis.fetch;
  const rpcCalls=[];
  globalThis.fetch=async(url,config)=>{
    const name=String(url).split('/').pop();
    rpcCalls.push(name);
    return new Response('false',{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const result=await syncNistiProductsToCommerce({
      SUPABASE_URL:'https://nisti.invalid',
      SUPABASE_SERVICE_ROLE_KEY:'test-key',
      SUPABASE_READS_ENABLED:'1'
    });
    assert.equal(result.skipped,true);
    assert.equal(result.reason,'catalog_not_imported');
    assert.equal(result.created,0);
    assert.deepEqual(rpcCalls,['commerce_has_marketplace_import_v1']);
  } finally {
    globalThis.fetch=before;
  }
});

test('Scanner panel list and details reuse badges only from linked imported Commerce data',()=>{
  const catalog=read('src/admin/CatalogView.jsx');
  const admin=read('src/main.jsx');
  assert.match(catalog,/export function CatalogPlatformTags/);
  assert.match(catalog,/syncStatus === 'SYNCED' && Number\(product\?\.commerce_sync\?\.commerce_product_id\) > 0/);
  assert.match(catalog,/confirmedCatalogLink \? catalogPlatforms\(product\) : \[\]/);
  assert.match(catalog,/Sem anúncio no catálogo/);
  assert.match(admin,/import CatalogView, \{ CatalogPlatformTags \}/);
  assert.match(admin,/<CatalogPlatformTags product=\{\{ \.\.\.product, commerce_sync: syncState \}\} \/>/);
  assert.doesNotMatch(admin,/<PlatformTag platform=\{product.platform\} \/>/);
  assert.doesNotMatch(admin,/nisti_commerce_initial_sync_v1/);
  assert.match(read('src/admin/CommerceSyncBadge.jsx'),/Aguardando Catálogo/);
});

test('backend bridge gate checks actual imports, not legacy Scanner platform assignments',()=>{
  const sql=read('supabase/migrations/20261015_commerce_scanner_import_gate_v1.sql');
  const src=read('src/nisti-commerce-sync.js');
  assert.match(sql,/FROM public\.commerce_source_files sf/);
  assert.match(sql,/JOIN public\.commerce_source_rows sr/);
  assert.match(sql,/FROM public\.commerce_listings/);
  assert.doesNotMatch(sql,/FROM public\.product_platforms/);
  assert.match(sql,/REVOKE EXECUTE ON FUNCTION/);
  assert.match(sql,/TO service_role/);
  assert.doesNotMatch(sql,/DELETE|TRUNCATE|DROP TABLE/);
  assert.match(src,/if \(importedCatalogAvailable !== true\)/);
  assert.match(src,/const products = await loadNistiProducts\(env, ids\)/);
});
