import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
const dash = read('src/ga/commerce-dashboard.jsx');

test('GA-012: seletor segmentado único nos dois modos, sem lista suspensa nem bloqueio automático', () => {
  assert.equal((dash.match(/<PlatformSelector /g) || []).length, 1, 'um só seletor, fora dos filtros do modo');
  assert.doesNotMatch(dash, /<Dropdown label="Plataforma"/);
  assert.doesNotMatch(dash, /platformBlocked|platformOptions/);
  const sel = read('src/ga/commerce-platform-selector.jsx');
  assert.match(sel, /role="radiogroup"/);
  assert.match(sel, /role="radio"/);
  assert.doesNotMatch(sel, /disabled/, 'nenhuma opção é desativada');
});

test('GA-012: todo estado por conta é guardado com a chave do escopo e só entra se for o escopo atual', () => {
  for (const name of ['dataE', 'overviewE', 'seriesE', 'monthlyE', 'cohortE', 'abcE']) assert.match(dash, new RegExp('\\[' + name + ','), name);
  assert.match(dash, /const scope=scopeKey\(\{platform,days,month\}\)/);
  assert.match(dash, /isCurrentScope\(dataE,scope\)&&matchesPlatform\(dataE\.data,platform\)/);
  assert.match(dash, /setDataE\(null\);setOverviewE\(null\)/);
  assert.match(dash, /abcKey=\[abcP,abcFrom,abcTo\]/);
  assert.doesNotMatch(dash, /setData\(|setOverview\(|setSeries\(|setMonthly\(|setAbcData\(|setCohortData\(/);
});

test('GA-012: painel Atenção, relatórios e textos respeitam a conta', () => {
  assert.match(dash, /<AttentionByPlatform platform=\{platform\}/);
  assert.match(read('src/ga/commerce-dashboard-problems.jsx'), /filterAttentionPlatforms\(allPlats,platform\)/);
  assert.match(dash, /perfStatus\(platform,\{ml:mlPerf,shopee:spPerf\}\)/);
  assert.doesNotMatch(dash, /ML Antigo e ML Novo juntos|Mercado Livre soma ML Antigo e ML Novo/);
  assert.match(read('src/ga/commerce-sales-report.jsx'), /setDataE\(null\);setError\(''\)/);
});

test('GA-012: não consome o Ads do overview e não renomeia pedidos', () => {
  assert.doesNotMatch(dash, /overview\??\.ads|ov\.ads/);
  assert.doesNotMatch(dash, /pedidos únicos/i);
});

test('GA-012: resumo GA-018 só da conta escolhida, depois do dashboard e sem valores monetários', () => {
  const strip = read('src/ga/commerce-platform-quality-strip.jsx');
  assert.match(dash, /ready:Boolean\(data\)/);
  assert.match(strip, /if\(!single\|\|!ready\|\|!period\)return undefined/);
  assert.match(strip, /if\(platform==='TODAS'\)return null/);
  assert.doesNotMatch(strip, /maskMoney|money\(|R\$/);
  assert.match(read('src/ga/commerce-admin-app-v2.jsx'), /<CommerceDashboard onOpenQuality=/);
});

test('GA-012: o teste de Chromium com respostas lentas e fora de ordem está ligado ao CI', () => {
  assert.match(read('.github/workflows/browser-smoke.yml'), /node test-browser\/platform-dashboard\.mjs/);
  const t = read('test-browser/platform-dashboard.mjs');
  for (const w of ['hold(', 'release(', 'fora de ordem', 'A→B→A']) assert.ok(t.includes(w), w);
});

test('GA-012: problemas, categorias, frete e relatório sem vendas só aceitam resultado do escopo pedido',()=>{
  assert.match(dash,/matchesDays\(p,problemDays\)\|\|!matchesDays\(g,problemDays\)/);
  assert.match(dash,/isCurrentScope\(problemsE,'p'\+problemDays\)/);
  assert.match(dash,/shipKey=\[abcFrom,abcTo\]/);
  assert.match(dash,/isCurrentScope\(shipE,shipKey\)/);
  const cat=read('src/ga/commerce-dashboard-categories.jsx');
  assert.match(cat,/raw\.key===platform\?raw:/);
  assert.match(cat,/matchesPlatform\(data,platform\)/);
  const rep=read('src/ga/commerce-sales-report.jsx');
  assert.match(rep,/dataE\.key===reqKey/);
  assert.match(rep,/matchesPlatform\(d,platform\)/);
});

test('GA-012: desempenho por conta e ID; sem mistura de mapas de relatórios; zero exige cobertura',()=>{
  assert.doesNotMatch(dash,/perfItems/);
  assert.match(dash,/perfItemFor\(r,\{ml:mlPerf,shopee:spPerf\}\)/);
  assert.match(dash,/dq:quality\.dq/);
  assert.match(dash,/dashboardQualityPeriod\(per,\{days,month\}\)/);
});
