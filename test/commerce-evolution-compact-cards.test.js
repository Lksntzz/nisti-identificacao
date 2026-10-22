import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
const css=fs.readFileSync('src/commerce-evolution-integrated.css','utf8');

test('commercial detail keeps 30/60/90 values compact and shows variation data first',()=>{
  assert.match(view,/<div className="nei-window-cards">/);
  assert.match(view,/<VariationSummary ad=\{ad\} days=\{days\}\/>/);
  assert.match(view,/<VariationTable ad=\{ad\} days=\{days\} focusWithoutSales=\{focusWithoutSales\}\/>/);
  assert.match(css,/\.nei-window-card\{[^}]*min-height:88px/);
  assert.match(css,/\.nei-ad-overview\{[^}]*align-items:start/);
  const start=view.indexOf('function Advertisement');
  const detail=view.slice(start,view.indexOf('export default',start));
  assert.ok(detail.indexOf('<VariationTable')<detail.indexOf('{showWeekly&&<WeeklyChart'));
});

test('variation summary counts verified sales, confirmed zero and pending separately',()=>{
  assert.match(view,/function VariationSummary\(\{ad,days\}\)/);
  assert.match(view,/const state=variationStateForAd\(v,days,ad\)/);
  assert.match(view,/state==='SOLD'\|\|state==='PARTIAL'/);
  assert.match(view,/else if\(state==='ZERO'\)acc\.zero\+\+/);
  assert.match(view,/else acc\.pending\+\+/);
  assert.match(view,/Com vendas identificadas/);
  assert.match(view,/Sem vendas confirmadas/);
  assert.match(view,/Dados pendentes/);
});

test('weekly chart is optional, avoids empty flat line and redundant database requests',()=>{
  assert.match(view,/\[showWeekly,setShowWeekly\]=useState\(false\)/);
  assert.match(view,/aria-expanded=\{showWeekly\}/);
  assert.match(view,/\{showWeekly&&<WeeklyChart listingId=\{ad\.listing_id\}\/>\}/);
  assert.match(view,/if\(weeklyTotal===0\)return/);
  assert.match(view,/Sem registros datados não significa ausência de vendas/);
  assert.match(view,/const ticks=max<=4\?/);
  assert.match(css,/\.nei-chart svg\{[^}]*max-height:185px/);
});
