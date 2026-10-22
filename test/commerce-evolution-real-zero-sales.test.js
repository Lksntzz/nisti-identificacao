import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const jsx=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
const css=fs.readFileSync('src/commerce-evolution-integrated.css','utf8');
const sql=fs.readFileSync('supabase/migrations/20261022200000_commerce_evolution_observed_zeros_v2.sql','utf8');
function cut(start,end){
  const from=jsx.indexOf(start),to=jsx.indexOf(end,from);
  assert.ok(from>=0&&to>from,'helper not found: '+start);
  return jsx.slice(from,to);
}
const source=[
  cut('const number=', 'const date='),
  cut('const known=', 'const variationSales='),
  cut('const verifiedUnsoldVariations=', 'const variationStateForAd=')
].join('\n');
const {verifiedUnsoldVariations,recordedUnits,recordedRevenue}=vm.runInNewContext(
  source+'\n({verifiedUnsoldVariations,recordedUnits,recordedRevenue})',{Intl}
);

test('zero filter exposes ten real Shopee SKU variations with no recorded sales',()=>{
  const ad={period_end:'2026-10-16',identified_30:0,identified_60:0,
    revenue_30:0,unlinked_30:0,variations:Array.from({length:10},(_,i)=>({
      id:i+1,name:'Modelo '+(i+1),sku:'ETQ_'+(i+1),match_verified:true,identified_30:0
    }))};
  assert.equal(recordedUnits(ad,30),'0 un.');
  assert.match(recordedRevenue(ad,30),/^R\$\s*0,00$/);
  assert.equal(verifiedUnsoldVariations(ad,30).length,10);
  assert.match(jsx,/zeroVariations\.slice\(0,4\)\.map/);
  assert.match(jsx,/zeroVariations\.length>4/);
  assert.match(jsx,/Variações com 0 vendas registradas:/);
});

test('mixed-sale listing shows only actual non-selling verified SKU names',()=>{
  const ad={period_end:'2026-10-16',identified_30:9,revenue_30:200,unlinked_30:0,
    variations:[
      {id:1,name:'Cabelo 1',match_verified:true,identified_30:2},
      {id:2,name:'Cabelo 2',match_verified:true,identified_30:0},
      {id:3,name:'Cabelo 3',match_verified:true,identified_30:1},
      {id:4,name:'Cabelo 4',match_verified:true,identified_30:1},
      {id:5,name:'Cabelo 5',match_verified:true,identified_30:5},
      {id:6,name:'Cabelo 6',match_verified:true,identified_30:0}
    ]};
  assert.equal(recordedUnits(ad,30),'9 un.');
  assert.equal(verifiedUnsoldVariations(ad,30).map(v=>v.name).join(', '),'Cabelo 2, Cabelo 6');
  assert.match(jsx,/focusWithoutSales\?noAdSales\?'Sem vendas':'Variações sem vendas'/);
});

test('unassigned listing sales cannot falsely mark a SKU as unsold',()=>{
  const ad={period_end:'2026-10-16',unlinked_30:5,identified_30:5,
    variations:[{id:1,name:'Azul',match_verified:true,identified_30:0}]};
  assert.equal(verifiedUnsoldVariations(ad,30).length,0);
  assert.match(sql,/a\.unlinked_30/);
  assert.match(sql,/a\.unsold_identified_variations>0/);
  assert.match(sql,/selling_ads_with_unsold_variations/);
});

test('zero view hides coverage classification while preserving report cutoff date',()=>{
  assert.match(jsx,/status!=='ZERO'&&coverage\.length>0/);
  assert.match(jsx,/!focusWithoutSales&&ad\['coverage_'\+days\]===false/);
  assert.match(jsx,/Fonte: relatórios importados até/);
  assert.match(jsx,/recordedRevenue\(ad,n\)/);
  assert.match(jsx,/observed=\{focusWithoutSales\}/);
  assert.match(css,/\.nei-zero-sku-preview/);
  assert.match(css,/\.nei-zero-sales-bar/);
});

test('backend preserves pagination and service-role-only read access',()=>{
  assert.match(sql,/limit \(select page_size from input\) offset \(select page_offset from input\)/);
  assert.match(sql,/revoke all on function public\.commerce_evolution_ads_v1/);
  assert.match(sql,/to service_role/);
  assert.match(sql,/daily as materialized/);
  assert.doesNotMatch(sql,/\b(?:truncate|delete from|insert into|update)\s+public\./i);
});
