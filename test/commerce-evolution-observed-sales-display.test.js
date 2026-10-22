import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const view=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
const css=fs.readFileSync('src/commerce-evolution-integrated.css','utf8');
function segment(start,end){
  const a=view.indexOf(start),b=view.indexOf(end,a);
  assert.ok(a>=0&&b>a,'Missing helper definition '+start);
  return view.slice(a,b);
}
const pure=[
  segment('const number=', 'const date='),
  segment('const known=', 'const variationSales='),
  segment('const observedVariationCounts=', 'const variationStateForAd=')
].join('\n');
const helpers=vm.runInNewContext(pure+'\n({observedVariationCounts,adUnitsLabel,adRevenueLabel})',{Intl});

test('zero detected in partial Shopee export is displayed as observed, not invented as certified',()=>{
  const variations=Array.from({length:10},(_,i)=>({id:i,match_verified:true,identified_30:0}));
  const ad={period_end:'2026-10-16',units_30:null,identified_30:0,
    coverage_30:false,revenue_30:0,unlinked_30:0,variations};
  assert.equal(helpers.adUnitsLabel(ad,30),'0 un.');
  assert.match(helpers.adRevenueLabel(ad,30),/^R\$\s*0,00$/);
  assert.equal(helpers.adRevenueLabel(ad,30).startsWith('≥'),false);
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.observedVariationCounts(ad,30))),
    {sold:0,withoutSales:10,pending:0});
  assert.match(view,/Os resultados são calculados somente sobre os registros importados/);
});

test('partial export with identified sales presents minimum amount and correct breakdown',()=>{
  const ad={period_end:'2026-10-16',units_30:null,identified_30:5,
    revenue_30:149.9,coverage_30:false,unlinked_30:0,
    variations:[{match_verified:true,identified_30:5},
      {match_verified:true,identified_30:0},{match_verified:false,identified_30:null}]};
  assert.equal(helpers.adUnitsLabel(ad,30),'5 un.');
  assert.match(helpers.adRevenueLabel(ad,30),/^R\$\s*149,90$/);
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.observedVariationCounts(ad,30))),
    {sold:1,withoutSales:1,pending:1});
});

test('unlinked ad-level sales must not falsely certify SKU zero',()=>{
  const ad={period_end:'2026-10-16',coverage_30:true,units_30:2,
    revenue_30:80,unlinked_30:2,
    variations:[{match_verified:true,identified_30:0}]};
  assert.equal(helpers.adUnitsLabel(ad,30),'2 un.');
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.observedVariationCounts(ad,30))),
    {sold:0,withoutSales:0,pending:1});
  assert.match(view,/Vínculo pendente/);
  assert.match(view,/identified=\{v\.match_verified&&!/);
});

test('no imported window does not fabricate any zero value',()=>{
  const ad={period_end:null,units_30:null,identified_30:0,revenue_30:0,coverage_30:false};
  assert.equal(helpers.adUnitsLabel(ad,30),'—');
  assert.equal(helpers.adRevenueLabel(ad,30),'—');
});

test('compact cards and variation rows show evidence and limit message',()=>{
  assert.match(view,/function Value\(\{value,identified=null,coverage=true,observed=false\}\)/);
  assert.match(view,/Number\(identified\)>0\?'≥ '/);
  assert.match(view,/:'0 identificadas'/);
  assert.match(view,/adRevenueLabel\(ad,n\)/);
  assert.match(view,/Vínculo ou dados pendentes/);
  assert.match(view,/Sem vendas identificadas/);
  assert.match(css,/\.nei-zero-sales-bar/);
  assert.match(view,/\{showWeekly&&<WeeklyChart listingId=\{ad\.listing_id\}\/>\}/);
});
