import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const listing=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const summary=fs.readFileSync('src/commerce-shopee-ads-summary.jsx','utf8');
const css=fs.readFileSync('src/commerce-ad-manager.css','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20261020174500_commerce_shopee_ads_coverage_v1.sql','utf8');
const detail=listing.slice(listing.indexOf('function ListingDetail('),
  listing.indexOf('export default function CommerceCommercialDashboard'));

test('Shopee Ads is a conditional fifth tab placed after Pós-venda',()=>{
  assert.match(listing,/const DETAIL_TABS=\[\['summary','Resumo'\],\['finance','Financeiro'\],\['variations','Variações'\],\['aftercare','Pós-venda'\]\]/);
  assert.match(detail,/hasShopeeAds&&item.source==='SHOPEE'/);
  assert.match(detail,/\[\.\.\.DETAIL_TABS,\['shopee_ads','Shopee Ads'\]\]/);
  assert.match(detail,/\{detailTabs.map\(\(\[code,label\]\)/);
  assert.match(detail,/activeTab==='shopee_ads'&&hasShopeeAds&&item.source==='SHOPEE'/);
  assert.match(detail,/CommerceShopeeAdsSummary listingId=\{item.id\}/);
  assert.match(css,/\.nim-detail-tab-list\.has-shopee-ads\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(detail,/\{item.source==='SHOPEE'&&<CommerceShopeeAdsSummary listingId=\{item.id\}\/>\}/);
});

test('extra Shopee Ads action is shown only for listings found in imported CSV',()=>{
  assert.match(listing,/readJson\(API\+'\/shopee-ads\/coverage\?ids='\+shopeeIds\.join\(','\)/);
  assert.match(listing,/const hasShopeeAds=id=>adsCoverage.state==='ready'/);
  assert.match(listing,/item.source==='SHOPEE'&&hasShopeeAds\(item.id\)&&<button/);
  assert.match(listing,/openListing\(item.id,'shopee_ads'\)/);
  assert.match(listing,/Shopee Ads ↗/);
  assert.match(listing,/Ver detalhes →/);
  assert.match(listing,/hasShopeeAds=\{hasShopeeAds\(selected.id\)\}/);
});

test('Shopee Ads tab loads paid traffic and metrics without another expansion',()=>{
  assert.match(summary,/Métricas e tráfego publicitário/);
  assert.match(summary,/Impressões \(tráfego pago\)/);
  assert.match(summary,/Cliques \(anúncios\)/);
  assert.match(summary,/CTR/);
  assert.match(summary,/Conversões Ads/);
  assert.match(summary,/Despesas/);
  assert.match(summary,/GMV atribuído/);
  assert.match(summary,/ROAS/);
  assert.match(summary,/não equivale a visitas orgânicas/);
  assert.doesNotMatch(summary,/<details|setOpen\(/);
  assert.match(detail,/Métricas adicionais de tráfego/);
});

test('coverage RPC excludes unlinked campaigns and non-Shopee ads and is admin-only',()=>{
  assert.match(migration,/commerce_shopee_ads_coverage_v1/);
  assert.match(migration,/r\.listing_id = any\(p_listing_ids\)/);
  assert.match(migration,/r\.external_product_id=l\.external_listing_id/);
  assert.match(migration,/m\.code='SHOPEE'/);
  assert.match(migration,/security invoker set search_path=public/);
  assert.match(migration,/revoke all .* from public,anon,authenticated/s);
  assert.match(migration,/to service_role/);
  assert.match(store,/commerceShopeeAdsCoverage/);
  assert.match(router,/\/listings\/manager\/shopee-ads\/coverage/);
  assert.match(router,/new Set\(ids\)\.size!==ids\.length/);
});
