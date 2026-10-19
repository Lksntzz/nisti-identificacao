import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  identifiedVariationCoverage,
  listingLinkedSalesForPeriod,
  listingClassificationCoverage,
  importedWindowDescription
} from '../src/commerce-ad-evidence.js';

test('Shopee: 4 capas com 457, 160, 495 e 74 unidades identificadas',()=>{
  const listing={
    total_variations:4,
    identified_variations:[
      {id:'376044301694',name:'CAPA 1',units:457},
      {id:'376044301695',name:'CAPA 2',units:160},
      {id:'376044301696',name:'CAPA 3',units:495},
      {id:'376044301697',name:'CAPA 4',units:74}
    ]
  };
  const result=identifiedVariationCoverage(listing,30);
  assert.equal(result.identified,4);
  assert.equal(result.total,4);
  assert.equal(result.variations[0].units,457);
});

test('venda não vinculada não é zero nem representa variação sem vendas',()=>{
  const listing={
    total_variations:4,
    identified_variations:[
      {id:'1',units:5},{id:'2',units:null},{id:'3',units:undefined},{id:'4',units:0}
    ],
    month_variations:[{id:'1',units:3},{id:'2',units:null}]
  };
  assert.equal(identifiedVariationCoverage(listing,30).identified,1);
  assert.equal(identifiedVariationCoverage(listing,0).identified,1);
  assert.equal(identifiedVariationCoverage(listing,0).total,4);
});

test('contagem única de variação e ausência de valores inválidos',()=>{
  const item={
    total_variations:5,
    identified_variations:[
      {id:'A',units:2},{id:'A',units:2},
      {id:'B',units:'3'}, {id:'C',units:'n/a'}, {id:'D',units:-10}
    ]
  };
  assert.equal(identifiedVariationCoverage(item,7).identified,2);
  assert.equal(identifiedVariationCoverage(item,7).total,5);
});

test('separa anúncios com venda vinculada dos que não têm classificação confiável',()=>{
  assert.deepEqual(listingClassificationCoverage({active_ads:316,identified_ads:120},30),
    {active:316,identified:120,unclassified:196});
  assert.deepEqual(listingClassificationCoverage({active_ads:316,identified_ads:149},90),
    {active:316,identified:149,unclassified:167});
  assert.deepEqual(listingClassificationCoverage({active_ads:316,month_linked_ads:125},0),
    {active:316,identified:125,unclassified:191});
  assert.equal(listingClassificationCoverage({active_ads:316,identified_ads:999},30).unclassified,0);
});

test('30 dias Shopee explicitamente terminam no último dia importado, não hoje',()=>{
  const formatter=iso=>iso.split('-').reverse().join('/');
  const msg=importedWindowDescription({
    period_start:'2026-09-01',period_end:'2026-09-30',
    data_through:'2026-09-30',source_kind:'DAILY_SKU_PARTIAL'
  },30,formatter);
  assert.match(msg,/30 dias disponíveis/);
  assert.match(msg,/01\/09\/2026 a 30\/09\/2026/);
  assert.match(msg,/última data importada: 30\/09\/2026/);
  assert.match(msg,/não é um período contado a partir de hoje/);
});

test('modo mensal e outros marketplaces conservam sua descrição regular',()=>{
  const formatter=iso=>iso;
  const x={period_start:'2026-01-01',period_end:'2026-01-31',source_kind:'MONTHLY_SKU_PARTIAL'};
  assert.equal(importedWindowDescription(x,0,formatter),
    'Período analisado: 2026-01-01 a 2026-01-31');
  assert.equal(importedWindowDescription(null,90,formatter),'Período conforme os filtros selecionados');
});

test('UI apresenta claramente os dados parciais, por variação e a última data importada',()=>{
  const jsx=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
  assert.match(jsx,/identifiedVariationCoverage\(item,days\)/);
  assert.match(jsx,/identifiedVariationCoverage\(detail,detailDays\)/);
  assert.match(jsx,/com vendas identificadas/);
  assert.match(jsx,/anúncios Shopee sem vendas identificadas por SKU no período/);
  assert.match(jsx,/anúncios sem vendas identificadas por SKU no período/);
  assert.match(jsx,/não são SKUs sem vínculo/);
  assert.match(jsx,/Pedid(?:os|o) não importados/);
  assert.doesNotMatch(jsx,/anúncios Shopee sem vendas vinculadas; não significa zero/);
  assert.match(jsx,/importedWindowDescription\(data,days,periodDate\)/);
  assert.match(jsx,/dias · dados importados/);
  assert.match(jsx,/partialRelevant\.map\(\(v,i\)=>/);
  assert.match(jsx,/v\.units==null\?'Não identificada':num\(v\.units\)/);
  assert.doesNotMatch(jsx,/Quantidade não identificada/);
});

test('mensal Shopee nunca herda as vendas de uma janela móvel',()=>{
  const item={source:'SHOPEE',month_linked_units:0,month_linked_revenue:0,
    identified_units:78,identified_revenue:3400};
  assert.deepEqual(listingLinkedSalesForPeriod(item,0),
    {hasSales:false,units:null,revenue:null});
  assert.deepEqual(listingLinkedSalesForPeriod(item,30),
    {hasSales:true,units:78,revenue:3400});
});

test('origem mista mensal usa somente vendas identificadas no próprio recorte',()=>{
  const item={source:'SHOPEE',identified_units:6,identified_revenue:219.90};
  assert.deepEqual(listingLinkedSalesForPeriod(item,0),
    {hasSales:true,units:6,revenue:219.90});
  const specific={...item,month_linked_units:4,month_linked_revenue:119.90};
  assert.deepEqual(listingLinkedSalesForPeriod(specific,0),
    {hasSales:true,units:4,revenue:119.90});
  assert.deepEqual(listingLinkedSalesForPeriod({source:'SHOPEE',identified_units:null},30),
    {hasSales:false,units:null,revenue:null});
  assert.deepEqual(listingLinkedSalesForPeriod({source:'ML_NOVO',units:5},30),
    {hasSales:false,units:null,revenue:null});
});

test('ficha do anúncio mostra datas reais quando selecionado outro período',()=>{
  const jsx=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
  assert.match(jsx,/setPeriodResult\(\{days:detailDays,item:found,periodStart:/);
  assert.match(jsx,/período independente do filtro principal/);
  assert.match(jsx,/const linkedEvidence=listingLinkedSalesForPeriod\(detail,detailDays\)/);
  assert.match(jsx,/const linked=listingLinkedSalesForPeriod\(item,days\)/);
  assert.doesNotMatch(jsx,/month_linked_units\|\|item\.identified_units/);
});
