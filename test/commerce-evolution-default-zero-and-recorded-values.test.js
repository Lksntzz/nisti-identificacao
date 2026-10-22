import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const panel=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
function chunk(a,b){const i=panel.indexOf(a),j=panel.indexOf(b,i);assert.ok(i>=0&&j>i);return panel.slice(i,j);}
const pure=[chunk('const number=', 'const date='),chunk('const known=', 'const variationSales='),chunk('const observedVariationCounts=', 'const variationStateForAd=')].join('\n');
const helper=vm.runInNewContext(pure+'\n({adUnitsLabel,adRevenueLabel,verifiedUnsoldVariations})',{Intl});

test('opening Evolution shows Sem vendas rather than all 299 listings',()=>{
  assert.match(manager,/\[evolutionStatus,setEvolutionStatus\]=useState\('ZERO'\)/);
  assert.match(manager,/status=\{evolutionStatus\} onStatusChange=\{setEvolutionStatus\}/);
  assert.match(panel,/const STATUS=\[\['ZERO','Sem vendas'\]/);
  assert.match(panel,/id:'ALL',label:'Total de anúncios'/);
});

test('sales shown in all-listings view equal imported sales, no greater-than estimate',()=>{
  const ad={period_end:'2026-10-16',identified_30:1145,identified_60:2268,identified_90:3000,
    revenue_30:38302.8,revenue_60:75249.5,revenue_90:99332.3,
    units_30:null,coverage_30:false};
  assert.equal(helper.adUnitsLabel(ad,30),'1.145 un.');
  assert.equal(helper.adUnitsLabel(ad,60),'2.268 un.');
  assert.match(helper.adRevenueLabel(ad,30),/^R\$\s*38\.302,80$/);
  assert.equal(helper.adUnitsLabel({period_end:'2026-10-16',identified_30:0},30),'0 un.');
  assert.equal(helper.adUnitsLabel({identified_30:0,period_end:null},30),'—');
  assert.match(panel,/const unitLabel=n=>adUnitsLabel\(ad,n\)/);
  assert.match(panel,/hasSales\?'Com vendas'/);
  assert.match(panel,/adRevenueLabel\(ad,n\)/);
  assert.match(panel,/Vendas registradas nos relatórios importados até/);
  assert.doesNotMatch(panel,/Cobertura parcial/);
});

test('verified selling and non-selling SKU breakdown is preserved with no false zeros',()=>{
  const ad={period_end:'2026-10-16',unlinked_30:0,variations:[
    {id:1,sku:'CADGES_CBL1_BBB',match_verified:true,identified_30:2},
    {id:2,sku:'CADGES_CBL2_BBB',match_verified:true,identified_30:0},
    {id:6,sku:'CADGES_CBL6_BBB',match_verified:true,identified_30:0}
  ]};
  assert.equal(helper.verifiedUnsoldVariations(ad,30).length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(helper.verifiedUnsoldVariations(ad,30).map(x=>x.sku))),
    ['CADGES_CBL2_BBB','CADGES_CBL6_BBB']);
  assert.equal(helper.verifiedUnsoldVariations({...ad,unlinked_30:3},30).length,0);
  assert.match(panel,/observed=\{true\}/);
  assert.match(panel,/Variações com 0 vendas registradas:/);
});

test('zero view remains paginated and keeps a visible data cutoff',()=>{
  assert.match(panel,/status!=='ZERO'&&coverage\.length>0/);
  assert.match(panel,/Fonte: relatórios importados até/);
  assert.match(panel,/const PAGE=12,WINDOWS=\[30,60,90\]/);
  assert.match(panel,/platform:selectedPlatform,days:String(days),status,limit:String(PAGE)/);
});
