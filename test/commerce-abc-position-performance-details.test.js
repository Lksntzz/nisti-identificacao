import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view=fs.readFileSync('src/commerce-commercial-dashboard.jsx','utf8');
const velocity=fs.readFileSync('src/commerce-sales-velocity.jsx','utf8');
const css=fs.readFileSync('src/commerce-sales-velocity.css','utf8');

test('Curva ABC appears immediately after compact performance summary; product details only below ABC',()=>{
  const performance=view.indexOf('mode="summary"');
  const abc=view.indexOf('className="nisti-com-section nisti-com-abc"');
  const details=view.indexOf('mode="details"');
  const graphs=view.indexOf('className="nisti-com-analytics"');
  assert.ok(performance>0&&abc>performance&&details>abc&&graphs>details);
  assert.match(view,/activePerformance&&<CommerceSalesVelocity/);
  assert.match(view,/selectedStatus=\{activePerformance\}/);
  assert.match(view,/setActivePerformance\(status\)/);
  assert.match(view,/setActivePerformance\(''\)/);
});

test('status cards show only totals until clicked, then detail opens without moving ABC',()=>{
  assert.match(velocity,/if\(mode === 'summary'\)/);
  const summary=velocity.slice(velocity.indexOf("if(mode === 'summary')"),velocity.indexOf('return <section id="nisti-vl-detail"'));
  assert.match(summary,/nisti-vl-metrics/);
  assert.match(summary,/METRICS\.map/);
  assert.match(summary,/onSelectStatus\?\.\(isSelected\?'':metric\.code\)/);
  assert.doesNotMatch(summary,/nisti-vl-list-heading|nisti-vl-list"|rows\.map/);
  assert.match(summary,/Ver produtos/);
  assert.match(summary,/Ocultar lista/);
  assert.match(velocity,/role="status"/);
  assert.match(velocity,/nisti-vl-details-header/);
  assert.match(velocity,/onClose\?\.\(\)/);
  assert.match(velocity,/rows\.map\(item/);
  assert.match(velocity,/onClick=\{\(\)=>setOffset\(v=>v\+15\)\}/);
});

test('ABC and performance selections are mutually exclusive to prevent simultaneous long panels',()=>{
  assert.match(view,/onSelectStatus=\{status=>\{setActivePerformance\(status\);if\(status\)setActiveCurve\(''\);\}\}/);
  assert.match(view,/setActiveCurve\(v=>v===curve\.code\?'':curve\.code\);setActivePerformance\(''\)/);
  assert.match(view,/const \[activePerformance,setActivePerformance\] = useState\(''\)/);
  assert.match(velocity,/key=\{item\.sku\}/);
  assert.match(velocity,/nisti-vl-product-kpis/);
});

test('desktop layout and sales API are preserved; new details remain compact',()=>{
  assert.match(velocity,/\/api\/admin\/commerce\/sales\/velocity/);
  assert.match(velocity,/days:String\(days\),platform,status:activeStatus/);
  assert.match(css,/\.nisti-vl-summary/);
  assert.match(css,/\.nisti-vl-details/);
  assert.match(css,/\.nisti-vl-close/);
  assert.match(css,/@media\(max-width:560px\)/);
  assert.doesNotMatch(view,/window\.innerWidth|useBreakpoint/);
});
