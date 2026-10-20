import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261019231000_commerce_manager_search_variation_sku.sql','utf8');
const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');

test('Gestor de Anúncios e mês Shopee pesquisam pelo SKU da variação',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.commerce_listing_manager_v1/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.commerce_listing_manager_month_sku_v2/);
  assert.equal((sql.match(/lp\.platform_sku ilike/g)||[]).length,2);
  assert.ok((sql.match(/public\.commerce_nisti_sku_norm_v1\(lp\.platform_sku\)/g)||[]).length>=2);
  assert.match(sql,/length\(public\.commerce_nisti_sku_norm_v1\(b\.search\)\)>=2/);
  assert.match(sql,/length\(public\.commerce_nisti_sku_norm_v1\(i\.search\)\)>=2/);
  assert.ok((sql.match(/lp\.relation_status<>'REMOVED'/g)||[]).length>=2);
});

test('Funções de pesquisa conservam venda e identidade em modo leitura com privilégios restritos',()=>{
  assert.equal((sql.match(/SECURITY INVOKER/g)||[]).length,2);
  assert.equal((sql.match(/revoke all on function/g)||[]).length,2);
  assert.equal((sql.match(/to service_role/g)||[]).length,2);
  assert.doesNotMatch(sql,/\b(?:update|delete|insert|truncate)\s+(?:into\s+|from\s+)?public\./i);
  assert.doesNotMatch(sql.replace(/^--.*$/gm,''),/\bscanner\b|commerce_nisti_product_links/i);
});

test('Totais por plataforma não transformam anúncios ML pendentes em Shopee',()=>{
  assert.match(sql,/shopee_active_ads/);
  assert.match(sql,/marketplace_active_ads/);
  assert.match(ui,/sourceBreakdown\.marketplacePending/);
  assert.match(ui,/label="Sem vendas"/);
});
