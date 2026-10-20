import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listingPlatformSalesBreakdown } from '../src/commerce-ad-evidence.js';

const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');

test('TODAS 30 dias: soma Shopee e Mercado Livre sem confundir venda ausente com sem vínculo',()=>{
  const r=listingPlatformSalesBreakdown({
    active_ads:552,covered_ads:236,sold_ads:109,identified_ads:139,
    zero_ads:128,identified_empty_ads:197
  },30,'MIXED_LISTING_SKU_PARTIAL');
  assert.deepEqual(r,{
    active:552,identified:248,withoutIdentified:304,
    marketplaceWithSales:109,marketplaceWithoutSales:127,marketplacePending:0,
    shopeeWithSales:139,shopeeWithoutLink:177
  });
});

test('TODAS 7 dias respeita as mesmas classes por plataforma',()=>{
  const r=listingPlatformSalesBreakdown({
    active_ads:552,covered_ads:236,sold_ads:60,identified_ads:89,
    zero_ads:176,identified_empty_ads:243
  },7,'MIXED_LISTING_SKU_PARTIAL');
  assert.equal(r.identified,149);
  assert.equal(r.withoutIdentified,403);
  assert.equal(r.marketplaceWithoutSales,176);
  assert.equal(r.shopeeWithoutLink,227);
});

test('TODAS mês personalizado: contas não usam contagem de variação vazia',()=>{
  const r=listingPlatformSalesBreakdown({
    active_ads:552,covered_ads:236,sold_ads:124,identified_ads:132,
    zero_ads:113,identified_empty_ads:209
  },0,'MIXED_LISTING_SKU_PARTIAL');
  assert.equal(r.identified,256);
  assert.equal(r.marketplaceWithoutSales,112);
  assert.equal(r.shopeeWithoutLink,184);
  assert.equal(r.withoutIdentified,296);
});

test('Shopee isolada mantém seus anúncios sem presumir zero nas vendas não vinculadas',()=>{
  const r=listingPlatformSalesBreakdown({
    active_ads:316,covered_ads:0,identified_ads:136,
    identified_empty_ads:199
  },30,'DAILY_SKU_PARTIAL');
  assert.equal(r.identified,136);
  assert.equal(r.shopeeWithoutLink,180);
  const monthly=listingPlatformSalesBreakdown({
    active_ads:316,covered_ads:0,month_linked_ads:132,
    identified_empty_ads:209
  },0,'MONTHLY_SKU_PARTIAL');
  assert.equal(monthly.identified,132);
  assert.equal(monthly.shopeeWithoutLink,184);
});

test('UI mostra distribuição verificável e não rotula variação vazia como anúncio parado',()=>{
  assert.match(ui,/sourceBreakdown\.marketplaceWithSales/);
  assert.match(ui,/sourceBreakdown\.shopeeWithSales/);
  assert.match(ui,/sourceBreakdown\.marketplaceWithoutSales/);
  assert.match(ui,/sourceBreakdown\.shopeeWithoutLink/);
  assert.match(ui,/anúncios ML sem vendas no período/);
  assert.match(ui,/anúncios Shopee sem vendas identificadas por SKU no período/);
  assert.doesNotMatch(ui,/anúncios Shopee sem vendas vinculadas; não significa zero/);
  assert.match(ui,/sourceBreakdown\?\.withoutIdentified\?\?0/);
  assert.match(ui,/const noSalesValue=kpi\.zero_ads/);
  assert.doesNotMatch(ui,/emptyIdentifiedAds=Number\(kpi\.identified_empty_ads/);
});

test('TODAS em mês incompleto não classifica Mercado Livre pendente como Shopee',()=>{
  const result=listingPlatformSalesBreakdown({
    active_ads:535,shopee_active_ads:299,marketplace_active_ads:236,
    covered_ads:0,sold_ads:0,identified_ads:122
  },0,'MIXED_LISTING_SKU_PARTIAL');
  assert.equal(result.active,535);
  assert.equal(result.marketplacePending,236);
  assert.equal(result.marketplaceWithoutSales,0);
  assert.equal(result.shopeeWithSales,122);
  assert.equal(result.shopeeWithoutLink,177);
  assert.equal(result.identified,122);
  assert.equal(result.withoutIdentified,413);
  assert.match(ui,/ML sem cobertura de vendas no período/);
});
