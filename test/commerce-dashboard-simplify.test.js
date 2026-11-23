import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const dash=fs.readFileSync('src/ga/commerce-dashboard.jsx','utf8');
const charts=fs.readFileSync('src/ga/commerce-dashboard-charts.jsx','utf8');
test('dashboard: cards "Faturamento" e "Vendendo" removidos; total continua no cabeçalho de Faturamento por produto',()=>{
  assert.doesNotMatch(dash,/label="Faturamento"/);
  assert.doesNotMatch(dash,/label="Vendendo"/);
  assert.match(dash,/Total \{money\(totals\.cur_rev\)\}/);
});
test('dashboard: "Vendas por dia" recolhe com botão aria-expanded, aberto por padrão',()=>{
  assert.match(dash,/collapsible/);
  assert.match(dash,/useState\(true\)/);
  assert.match(dash,/aria-expanded=\{open\}/);
});
test('PlatformSplit: pizza em SVG com fatias clicáveis',()=>{
  const s=charts.slice(charts.indexOf('export function PlatformSplit'),charts.indexOf('export function PlatformTable'));
  assert.match(s,/<svg/);assert.match(s,/<path/);assert.match(s,/onPick/);
});
