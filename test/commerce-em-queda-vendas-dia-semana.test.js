import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deltaPct } from '../src/commerce-sales-breakdown-helpers.js';

const dash = readFileSync('src/commerce-dashboard.jsx', 'utf8');
const router = readFileSync('src/commerce-admin-router.js', 'utf8');
const store = readFileSync('src/commerce-supabase-store.js', 'utf8');
const sql = readFileSync('supabase/migrations/20261028100000_commerce_listing_sales_breakdown_v2.sql', 'utf8');

test('variacao percentual entre periodos', () => {
  assert.equal(deltaPct(257, 296), -13.2);
  assert.equal(deltaPct(41, 47), -12.8);
  assert.equal(deltaPct(5, 0), null);
});

const manager = readFileSync('src/commerce-ad-manager.jsx', 'utf8');

test('listas do Painel Comercial mostram historico de vendas por semana, dia e mes', () => {
  assert.doesNotMatch(dash, /<th>Por que caiu<\/th>/);
  assert.match(dash, /<th>Histórico de vendas<\/th>/);
  assert.match(dash, /<th>Vendas por semana, dia e mês<\/th>/);
  assert.match(dash, /<th>Como vendia antes de parar<\/th>/);
  assert.match(dash, /useSalesBreakdown\(stoppedIds,'last_sale'\)/);
  assert.match(dash, /useSalesBreakdown\(noSalesIds,'last_sale'\)/);
  assert.match(dash, /useSalesMonths\(/);
  assert.match(dash, /<DailySalesRow /);
  assert.match(dash, /<MonthsPanelRow /);
});

test('rota e funcao SQL de vendas por dia e semana validam entrada e sao somente leitura', () => {
  assert.match(router, /listings\/manager\/sales-breakdown/);
  assert.match(store, /commerce_listing_sales_breakdown_v2/);
  assert.match(sql, /language sql stable/);
  assert.match(sql, /revoke all on function public\.commerce_listing_sales_breakdown_v2\(bigint\[\],text\) from public,anon,authenticated/);
  assert.doesNotMatch(sql, /\b(insert into|update public|delete from)\b/i);
});

test('Pararam e Sem vendas usam ancora last_sale', () => {
  assert.match(router, /anchor/);
  assert.match(sql, /p_anchor='last_sale'/);
});

test('Dashboard: 4 indices de performance no lugar dos cards de faturamento', () => {
  for (const l of ['Vendendo', 'Em queda', 'Vendia e parou', 'Não vendeu']) assert.match(dash, new RegExp('label="' + l + '"'));
  assert.doesNotMatch(dash, /label="Faturamento total"|label="Investimento em anúncios"|label="ROAS dos anúncios"/);
});

test('Dashboard: grafico mostra faturamento por produto conforme o filtro', () => {
  assert.match(dash, /<RevenueByProduct items=\{top\}/);
  assert.match(dash, /title="Faturamento por produto"/);
  assert.doesNotMatch(dash, /<DailyChart|<MonthlyChart|segment-series/);
});

const panel = readFileSync('src/commerce-commercial-panel.jsx', 'utf8');
test('Painel Comercial e so o desempenho (explorer) mais o menu Importar', () => {
  const app = readFileSync('src/commerce-admin-app-v2.jsx', 'utf8');
  assert.match(panel, /<CommerceDashboard key=\{[^}]*\} mode="explorer"/);
  assert.match(panel, /COMMERCE_IMPORT_OPTIONS/);
  assert.match(panel, /Importar arquivo/);
  assert.doesNotMatch(panel, /nim-ad-table|ListingDetail/);
  assert.match(app, /<CommerceCommercialPanel /);
  assert.doesNotMatch(app, /commerce-ad-manager/);
  assert.match(app, /onOpenTab=\{openPerformance\}/);
  assert.match(dash, /mode==='explorer'&&<section className="ndb-panel ndb-explorer">/);
  assert.match(dash, /mode==='overview'&&<Panel title="Faturamento por produto"/);
});

test('topo do GA: titulo da tela, bolinha de conexao real e atualizar em icone, sem Sair', () => {
  const app = readFileSync('src/commerce-admin-app-v2.jsx', 'utf8');
  assert.doesNotMatch(app, /\{IS_GA \? 'GA - Gestor de Anúncio' :/);
  assert.match(app, /VIEW_TITLES\[activeItem\.id\]/);
  assert.match(app, /\/api\/admin\/commerce\/health/);
  assert.match(app, /useDatabaseStatus/);
  assert.match(app, /aria-label="Atualizar dados"/);
  assert.match(app, /\{!IS_GA && <form method="POST" action="\/admin-logout"/);
  assert.doesNotMatch(app, /welcome-banner commerce-welcome-banner/);
  assert.doesNotMatch(panel, /Atualizar<\/button>/);
});

test('lista Melhores nao mostra colunas Investimento e ROAS por anuncio', () => {
  const best = dash.slice(dash.indexOf("tab==='best'&&<>"), dash.indexOf("tab==='drops'&&!all"));
  assert.doesNotMatch(best, /Investimento|ROAS<\/th>/);
  assert.doesNotMatch(dash, /adsByListing/);
});

test('indicador de conexao usa consulta leve e sem ambiguidade de funcao', () => {
  assert.match(store, /commerceDatabaseHealth/);
  assert.match(store, /nisti_system_health_core_v1/);
  assert.match(store, /commerce_dashboard_v1', \{ p_platform: 'TODAS', p_days: 30 \}/);
  assert.match(router, /commerceDatabaseHealth\(env\)/);
  assert.doesNotMatch(router, /products: Number\(dashboard\?\.products/);
});

test('indicador de conexao tenta duas vezes e mostra o motivo da falha', () => {
  const app = readFileSync('src/commerce-admin-app-v2.jsx', 'utf8');
  assert.match(app, /attempt < 2/);
  assert.match(app, /status\.detail/);
  assert.match(store, /supabase_rpc|error\?\.code/);
  assert.match(router, /error: database\.error/);
});

test('coluna Plataforma so aparece em Todas as plataformas; health usa chamada direta', () => {
  assert.match(dash, /const multi=platform==='TODAS'/);
  assert.match(dash, /\{multi&&<th>Plataforma<\/th>\}/);
  assert.doesNotMatch(dash, /<th>Plataforma<\/th><th>Status<\/th>/);
  assert.match(store, /directSupabaseRpc\(env, 'nisti_system_health_core_v1'/);
});

test('Painel Comercial tem blocos Em alta, Muita visita pouca venda e Vendas por mês (só no explorer)',()=>{
  const src=readFileSync(new URL('../src/commerce-dashboard.jsx',import.meta.url),'utf8');
  assert.match(src,/mode==='explorer'&&<Panel title="Em alta"/);
  assert.match(src,/mode==='explorer'&&<Panel title="Muita visita, pouca venda"/);
  assert.match(src,/mode==='explorer'&&<Panel title="Vendas por mês \(unidades\)"/);
  assert.match(src,/Number\(pf\.visits\)>=300/);
  assert.match(src,/sales-dashboard\/monthly\?platform=/);
});

test('Painel Comercial: Importar fica ao lado dos filtros e há busca por produto, SKU ou código',()=>{
  const dash=readFileSync(new URL('../src/commerce-dashboard.jsx',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../src/commerce-commercial-panel.jsx',import.meta.url),'utf8');
  assert.match(dash,/aria-label="Buscar produto, SKU ou código do anúncio"/);
  assert.match(dash,/\{actions\}/);
  assert.match(panel,/actions=\{importMenu\}/);
  assert.doesNotMatch(panel,/<header className="nim-heading"/);
});

test('aba Cadastros por mês: rota, consulta no banco e tela estão ligadas',()=>{
  const r=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
  const router=r('src/commerce-admin-router.js'),store=r('src/commerce-supabase-store.js');
  const dash=r('src/commerce-dashboard.jsx'),tab=r('src/commerce-cohorts.jsx');
  const mig=r('supabase/migrations/20261028150100_commerce_listing_cohorts_v1.sql');
  assert.match(router,/sales-dashboard\/cohorts/);
  assert.match(router,/platform\.startsWith\('ML_'\)\?'ML':platform/);
  assert.match(store,/commerce_listing_cohorts_v1/);
  assert.match(dash,/\['cohorts','Cadastros por mês',null\]/);
  assert.match(dash,/<CohortsTab platform=\{platform\} query=\{query\}\/>/);
  assert.match(tab,/sales-dashboard\/cohorts\?platform=/);
  assert.match(mig,/grant execute on function public\.commerce_listing_cohorts_v1\(text\) to service_role/);
  assert.match(mig,/revoke all on public\.commerce_listing_creation_v1 from public, anon, authenticated/);
  assert.equal((mig.match(/^\s+\('(SHOPEE|ML)',/gm)||[]).length,99);
});
