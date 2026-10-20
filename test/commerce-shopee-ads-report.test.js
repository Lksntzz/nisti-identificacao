import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseShopeeAdsCsv,parseShopeeCsvGrid} from '../src/commerce-shopee-ads-csv-reader.js';
const migration=fs.readFileSync('supabase/migrations/20261020160000_commerce_shopee_ads_reporting_v1.sql','utf8');
const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const imports=fs.readFileSync('src/commerce-import-center.jsx','utf8');
const importPanel=fs.readFileSync('src/commerce-shopee-ads-import.jsx','utf8');
const summary=fs.readFileSync('src/commerce-shopee-ads-summary.jsx','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const demo=(targeting=false)=>[
'Relatório de Todos os Anúncios CPC - Shopee Brasil',
'Nome de Usuário,example','Nome da loja,Loja Exemplo','ID da Loja,376221706',
'Data de Criação do Relatório,20/10/2026 09:40',
'Período,20/07/2026 - 20/10/2026','',
['#','Nome do Anúncio','ID do produto',...(targeting?['Palavra-chave/Localização']:[]),
'Impressões','Cliques','CTR','Conversões','Taxa de Conversão','Itens Vendidos','GMV','Despesas','ROAS'].join(','),
['1','Caderno Floral','12345678901',...(targeting?['Selecionado Automaticamente']:[]),
 '1000','50','5.00%','2','4.00%','3','130.20','22.00','5.92'].join(','),
['2','Grupo campanha','-',...(targeting?['-']:[]),
 '100','4','4.00%','1','25.00%','1','50.00','10.00','5.00'].join(',')
].join('\n');

test('parse Shopee 93-day general and targeting reports without converting to daily data',()=>{
 const general=parseShopeeAdsCsv(demo(),'ads.csv');
 const targeting=parseShopeeAdsCsv(demo(true),'keywords.csv');
 assert.equal(general.days,93);
 assert.equal(general.report.kind,'GENERAL');
 assert.equal(targeting.report.kind,'TARGETING');
 assert.equal(targeting.hasExplicitKeywords,false);
 assert.equal(general.rows[0].product_id,'12345678901');
 assert.equal(general.rows[1].product_id,null);
 assert.equal(general.rows[0].ctr_pct,5);
 assert.equal(general.rows[0].spend,22);
});
test('quoted commas do not corrupt report columns',()=>{
 const csv=demo().replace('Caderno Floral','"Caderno, Floral"');
 assert.equal(parseShopeeAdsCsv(csv).rows[0].name,'Caderno, Floral');
 assert.deepEqual(parseShopeeCsvGrid('"a","b""c"\n')[0],['a','b"c']);
});
test('reject unexpected format or invalid values',()=>{
 assert.throws(()=>parseShopeeAdsCsv('não é Shopee Ads'),/não identificado/);
 assert.throws(()=>parseShopeeAdsCsv(demo().replace('5.00%','120.00%')),/fora do limite/);
 assert.throws(()=>parseShopeeAdsCsv(demo().replace('20/07/2026 - 20/10/2026','20/10/2026 - 20/07/2026')),/Período fora/);
});
test('source and sales stay separate; deduplication and access are restricted',()=>{
 assert.match(migration,/commerce_shopee_ads_reports_v1/);
 assert.match(migration,/commerce_shopee_ads_rows_v1/);
 assert.match(migration,/unique\(shop_id,report_kind,period_start,period_end,sha256\)/);
 assert.match(migration,/on conflict\(shop_id,report_kind,period_start,period_end,sha256\) do nothing/);
 assert.match(migration,/security invoker set search_path=public/);
 assert.match(migration,/enable row level security/);
 assert.match(migration,/from public,anon,authenticated/);
 assert.match(migration,/to service_role/);
 assert.doesNotMatch(migration,/insert into public\.commerce_sales_rows|update public\.commerce_listings/i);
 assert.match(importPanel,/não serão repartidos artificialmente/);
 assert.match(summary,/não é adicionado aos totais/);
});
test('commercial view remains compact with no diagnosis tab and optional Shopee Ads',()=>{
 assert.match(ui,/CommerceShopeeAdsSummary listingId=\{item\.id\}/);
 assert.match(ui,/useState\('summary'\)/);
 assert.doesNotMatch(ui,/\['diagnosis','Diagnóstico'\]/);
 assert.match(imports,/mode === 'ads'/);
 assert.match(imports,/CommerceShopeeAdsImport/);
 assert.match(router,/commerceImportShopeeAdsReport\(env,body\)/);
 assert.match(store,/commerce_shopee_ads_import_v1/);
});
