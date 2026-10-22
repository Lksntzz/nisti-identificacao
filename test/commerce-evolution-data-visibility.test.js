import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const jsx=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
const css=fs.readFileSync('src/commerce-evolution-integrated.css','utf8');

test('first listing opens real details immediately and others expose a clear action',()=>{
  assert.match(jsx,/function Advertisement\(\{ad,days,initialExpanded=false,focusWithoutSales=false\}\)/);
  assert.match(jsx,/\[expanded,setExpanded\]=useState\(initialExpanded\)/);
  assert.match(jsx,/rows\.map\(ad=><Advertisement/);
  assert.match(jsx,/initialExpanded=\{ad\.listing_id===rows\[0\]\?\.listing_id\}/);
  assert.match(jsx,/Ver dados/);
  assert.match(jsx,/Ocultar dados/);
  assert.match(css,/\.nei-details-label\{font-size:10px;font-weight:800\}/);
});

test('ad row shows observed sold zeros and pending counts from verified variation records',()=>{
  assert.match(jsx,/observedVariationCounts\(ad,days\)/);
  assert.match(jsx,/counts\.withoutSales>0/);
  assert.match(jsx,/counts\.pending>0/);
  assert.match(jsx,/kpis\.with_sales/);
  assert.match(jsx,/Os resultados são calculados somente sobre os registros importados/);
  assert.match(jsx,/variationSales\(v,n\)/);
  assert.match(jsx,/showWeekly&&<WeeklyChart listingId=\{ad\.listing_id\}/);
});

test('list keeps filter logic and does not fetch extra data for rendering',()=>{
  assert.match(jsx,/key=\{\[selectedPlatform,days,status,search,offset,ad\.listing_id\]\.join\(':'\)\}/);
  assert.doesNotMatch(jsx,/fetch\([^)]*variation-summary/);
  assert.match(css,/\.nei-ad-overview\{[^}]*align-items:start/);
});
