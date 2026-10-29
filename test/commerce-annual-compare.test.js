import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { growth, pctText } from '../src/commerce-annual-compare-helpers.js';

test('growth nao inventa percentual sem base', () => {
  assert.equal(growth(10, 0), null);
  assert.equal(growth(50, 100), -50);
  assert.equal(pctText(null), '—');
  assert.equal(pctText(12.34), '+12,3%');
});

test('SQL do comparativo anual e somente leitura e restrito ao service_role', () => {
  for (const f of ['20261029120000_commerce_annual_compare_v1', '20261029130000_commerce_annual_compare_coverage_v1']) {
    const sql = fs.readFileSync(`supabase/migrations/${f}.sql`, 'utf8');
    assert.match(sql, /revoke all on function[^;]*from public,\s*anon,\s*authenticated/i);
    assert.match(sql, /grant execute on function[^;]*to service_role/i);
  }
  assert.match(fs.readFileSync('src/commerce-admin-router.js', 'utf8'), /sales-compare\/annual/);
});

test('Painel Comercial tem submenu com os tres itens', () => {
  const p = fs.readFileSync('src/commerce-admin-app-v2.jsx', 'utf8');
  for (const l of ['Painel Comercial', 'Comparação anual', 'Categorias']) assert.ok(p.includes(l));
});

import { indexOf, weekHighlights } from '../src/commerce-annual-compare-helpers.js';
test('indice 100 = igual ao ano passado e nao existe sem base', () => {
  assert.equal(indexOf(55, 100), 55);
  assert.equal(indexOf(150, 100), 150);
  assert.equal(indexOf(10, 0), null);
});
test('destaques de semana ignoram semana parcial e semana 5', () => {
  const [m] = weekHighlights([{ month: 10, weeks: [
    { n: 1, cur: 900, base: 2090, days: 7 }, { n: 2, cur: 1359, base: 2302, days: 7 },
    { n: 3, cur: 1286, base: 2146, days: 7 }, { n: 4, cur: 100, base: 1762, days: 3 }] }]);
  assert.equal(m.best.n, 2);
  assert.equal(m.worst.n, 1);
  assert.equal(m.cur, 3645);
});
test('SQL mensal e restrito ao service_role e rota existe', () => {
  const sql = fs.readFileSync('supabase/migrations/20261029140000_commerce_annual_month_v1.sql', 'utf8');
  assert.match(sql, /revoke all on function[^;]*from public,\s*anon,\s*authenticated/i);
  assert.match(fs.readFileSync('src/commerce-admin-router.js', 'utf8'), /sales-compare\/annual-month/);
});

test('alias de SKU e restrito ao service_role', () => {
  const sql = fs.readFileSync('supabase/migrations/20261029150000_commerce_sku_alias_v1.sql', 'utf8');
  assert.match(sql, /CADMNAPFL/);
  assert.match(sql, /revoke all on public\.commerce_sku_alias_v1 from public,anon,authenticated/i);
});

test('migracao de desempenho cria o indice de nome por SKU', () => {
  assert.match(fs.readFileSync('supabase/migrations/20261029180000_commerce_annual_perf_v1.sql', 'utf8'), /commerce_product_skus_canon_idx/);
});

test('submenu do Painel Comercial fica na lateral com Comparação anual e Categorias', () => {
  const app = fs.readFileSync('src/commerce-admin-app-v2.jsx', 'utf8');
  assert.match(app, /COMMERCIAL_SUBITEMS/);
  assert.match(app, /Comparação anual/);
  assert.match(app, /Categorias/);
  assert.doesNotMatch(fs.readFileSync('src/commerce-commercial-panel.jsx', 'utf8'), /ndb-ac-tabs/);
});

import { productLabel, share } from '../src/commerce-annual-compare-helpers.js';
test('produto: tira a marca, separa a colecao e trata cadastro ausente', () => {
  const a = productLabel('Nisti Print Caderneta de Vacinação Menino Personalizado Coleção Safari', 'X');
  assert.equal(a.title, 'Caderneta de Vacinação Menino Personalizado');
  assert.equal(a.collection, 'Safari');
  assert.equal(productLabel(null, 'ABC').title, 'Sem cadastro');
  assert.equal(share(50, 200), 25);
  assert.equal(share(5, 0), null);
});

test('produtos do dia: rota validada, SQL restrito e links nos produtos', () => {
  const sql = fs.readFileSync('supabase/migrations/20261029200000_commerce_annual_day_products_v1.sql', 'utf8');
  assert.match(sql, /revoke all on function public\.commerce_annual_day_products_v1/i);
  assert.match(fs.readFileSync('src/commerce-admin-router.js', 'utf8'), /annual-day-products/);
  const ui = fs.readFileSync('src/commerce-annual-compare.jsx', 'utf8');
  assert.match(ui, /ProductLinks/);
  assert.match(ui, /PeriodProducts/);
  assert.match(ui, /rel="noopener noreferrer"/);
});

test('produtos do mês são buscados para o mês exibido, inclusive o padrão', () => {
  const ui = fs.readFileSync('src/commerce-annual-compare.jsx', 'utf8');
  assert.match(ui, /defaultMonth/);
  assert.match(fs.readFileSync('src/commerce-annual-guided.jsx', 'utf8'), /Number\(monthData\.month\)===selectedMonth/);
});

test('botoes e tabelas do painel herdam a fonte sem sobrescrever tamanhos das classes', () => {
  const g = fs.readFileSync('src/commerce-annual-guided.css', 'utf8');
  assert.match(g, /\.ga-y-guided :where\(button,select,input,table\)\{font:inherit\}/);
  assert.doesNotMatch(g, /\.ga-y-guided button,\.ga-y-guided select\{font:inherit\}/);
  assert.match(fs.readFileSync('src/commerce-annual-compare.css', 'utf8'), /Plus Jakarta Sans/);
});

test('filtros usam o seletor do Painel Comercial e bloqueiam plataforma sem base', () => {
  const g = fs.readFileSync('src/commerce-annual-guided.jsx', 'utf8');
  const c = fs.readFileSync('src/commerce-annual-compare.jsx', 'utf8');
  assert.match(g, /import \{ Dropdown \} from '\.\/commerce-dashboard\.jsx'/);
  assert.match(g, /platformOptions/);
  assert.match(c, /não dá para comparar/);
  assert.doesNotMatch(g, /<label>Plataforma<select/);
});

test('periodo: SQL restrito, rota e abertura direta na semana mais recente', () => {
  const sql = fs.readFileSync('supabase/migrations/20261029210000_commerce_annual_period_products_v1.sql', 'utf8');
  assert.match(sql, /revoke all on function public\.commerce_annual_period_products_v1/i);
  assert.match(fs.readFileSync('src/commerce-admin-router.js', 'utf8'), /annual-period-products/);
  const g = fs.readFileSync('src/commerce-annual-guided.jsx', 'utf8');
  assert.match(g, /PeriodProducts/);
  assert.doesNotMatch(g, /Voltar às semanas/);
});

test('periodo igual ao Painel Comercial: 7/30/60/90 dias e meses, sem "todo o histórico"', () => {
  const g = fs.readFileSync('src/commerce-annual-guided.jsx', 'utf8');
  assert.match(g, /import PeriodPicker from '\.\/commerce-period-picker\.jsx'/);
  assert.match(g, /periods=\{\[7,30,60,90\]\} allowAll=\{false\}/);
  assert.match(g, /annual-window/);
  const pp = fs.readFileSync('src/commerce-period-picker.jsx', 'utf8');
  assert.match(pp, /allowAll&&/);
  const sql = fs.readFileSync('supabase/migrations/20261029220000_commerce_annual_window_v1.sql', 'utf8');
  assert.match(sql, /revoke all on function public\.commerce_annual_window_v1/i);
  assert.match(fs.readFileSync('src/commerce-admin-router.js', 'utf8'), /annual-window/);
});

test('produtos do mês mostram o preço médio vendido nos dois anos', () => {
  const ui = fs.readFileSync('src/commerce-annual-compare.jsx', 'utf8');
  assert.match(ui, /Preço \{base\}/);
  assert.match(ui, /Preço \{year\}/);
  assert.match(fs.readFileSync('supabase/migrations/20261029230000_commerce_annual_month_prices_v1.sql', 'utf8'), /'cur_rev',cr,'base_rev',br/);
});

import {periodParams,periodQuery,periodLabel,categoryKpis,listCategories,unitPrice} from '../src/commerce-categories-helpers.js';

test('categorias: período segue dias > mês > acumulado e a consulta carrega o par exato', () => {
  assert.deepEqual(periodParams({days:30,month:'9'}), {mode:'days',days:30});
  assert.deepEqual(periodParams({month:'9'}), {mode:'month',month:9});
  assert.deepEqual(periodParams({}), {mode:'ytd'});
  assert.equal(periodQuery({platform:'SHOPEE',month:'9'},2026), 'platform=SHOPEE&year=2026&mode=month&month=9');
  assert.match(periodLabel({mode:'ytd',cur_from:'2026-01-01',cur_to:'2026-10-26',base_from:'2025-01-01',base_to:'2025-10-26'}), /Acumulado até 26\/10\/2026 × até 26\/10\/2025/);
});

test('categorias: KPIs ignoram base ausente e estáveis; busca só esconde linhas', () => {
  const d={total:{cur:100,base:90},categories:[
    {name:'A',cur:50,base:40,c28:5,b28:9},{name:'B',cur:30,base:30,c28:1,b28:1},{name:'C',cur:10,base:20,c28:0,b28:4},
    {name:'D',cur:5,base:0,c28:5,b28:0},{name:'Sem categoria',cur:5,base:0,c28:0,b28:0}]};
  const k=categoryKpis(d);
  assert.equal(k.up,1); assert.equal(k.down,1); assert.equal(k.noneUnits,5); assert.equal(k.units,100);
  assert.deepEqual(listCategories(d.categories,{search:'sem'}).map(c=>c.name), ['Sem categoria']);
  assert.equal(categoryKpis(d).units,100);
  assert.deepEqual(listCategories(d.categories,{show:'down'}).map(c=>c.name), ['C']);
  assert.deepEqual(listCategories(d.categories,{sort:'loss'}).map(c=>c.name)[0], 'C');
  assert.equal(unitPrice(0,5), null);
  assert.equal(unitPrice(100,4), 25);
});

test('categorias: migração, rotas e painel existem e validam entradas', () => {
  const sql = fs.readFileSync('supabase/migrations/20261029240000_commerce_categories_v2.sql','utf8');
  assert.match(sql,/commerce_categories_v2/); assert.match(sql,/commerce_categories_sub_v2/);
  assert.match(sql,/revoke all on function public\.commerce_categories_v2/);
  assert.match(sql,/r_up<=5/);
  const router = fs.readFileSync('src/commerce-admin-router.js','utf8');
  assert.match(router,/sales-compare\/categories-sub/); assert.match(router,/Filtro de categorias inválido/);
  assert.match(fs.readFileSync('src/commerce-commercial-panel.jsx','utf8'),/CommerceCategoriesPanel/);
});
