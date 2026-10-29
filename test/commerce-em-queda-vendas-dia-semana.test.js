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
  assert.match(dash, /Vendas por semana/);
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
  assert.match(src,/<Panel title="Em alta"/);
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
  assert.match(store,/commerce_listing_cohorts_v5/);
  assert.match(dash,/\['cohorts','Cadastros por mês',null\]/);
  assert.match(dash,/<CohortsTab platform=\{platform\} query=\{query\} linkFor=\{listingUrl\}\/>/);
  assert.match(tab,/sales-dashboard\/cohorts\?platform=/);
  assert.match(mig,/grant execute on function public\.commerce_listing_cohorts_v1\(text\) to service_role/);
  assert.match(mig,/revoke all on public\.commerce_listing_creation_v1 from public, anon, authenticated/);
  assert.equal((mig.match(/^\s+\('(SHOPEE|ML)',/gm)||[]).length,99);
});

test('Cadastros por mês: detalhe por variação, melhor mês e links',()=>{
  const r=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
  const router=r('src/commerce-admin-router.js'),store=r('src/commerce-supabase-store.js'),tab=r('src/commerce-cohorts.jsx');
  const mig=r('supabase/migrations/20261028160000_commerce_listing_cohorts_v2.sql');
  assert.match(router,/sales-dashboard\/cohorts\/detail/);
  assert.match(router,/Filtro do detalhe inválido/);
  assert.match(store,/commerce_listing_cohort_detail_v7/);
  assert.match(tab,/sales-dashboard\/cohorts\/detail\?platform=/);
  assert.match(tab,/role="dialog"/);
  assert.match(tab,/Por dia/);assert.match(tab,/Por semana/);assert.match(tab,/Por mês/);
  assert.match(tab,/Melhor mês/);assert.match(tab,/Mostrar mais/);
  assert.match(mig,/grant execute on function public\.commerce_listing_cohort_detail_v1\(text,text\) to service_role/);
  assert.match(mig,/best_month/);
});

test('Dashboard (visão geral): resumo, gráfico de vendas por dia, plataforma e resumo do período',()=>{
  const dash=readFileSync(new URL('../src/commerce-dashboard.jsx',import.meta.url),'utf8');
  const ch=readFileSync(new URL('../src/commerce-dashboard-charts.jsx',import.meta.url),'utf8');
  assert.match(dash,/sales-dashboard\/series\?platform=/);
  assert.match(dash,/<SalesTrend daily=\{series\.daily\}/);
  assert.match(dash,/title="Faturamento por plataforma"/);
  assert.match(dash,/title="Resumo do período"/);
  assert.match(dash,/Ticket médio por unidade/);
  assert.match(ch,/onMouseMove/);
  assert.match(ch,/Dia equivalente anterior/);
});

test('Dashboard: filtro por mês específico e histórico de todos os meses',()=>{
  const r=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
  const dash=r('src/commerce-dashboard.jsx'),router=r('src/commerce-admin-router.js'),store=r('src/commerce-supabase-store.js');
  const mig=r('supabase/migrations/20261028150000_commerce_dashboard_month_filter_v1.sql');
  const ser=r('supabase/migrations/20261028170000_commerce_dashboard_month_series_v1.sql');
  assert.match(dash,/<MonthsTrend months=\{yearMonths\}/);
  assert.match(dash,/sales-dashboard\/series\?platform=.*month=/);
  assert.match(dash,/'&month='\+month/);
  assert.match(router,/sales-dashboard\/month-series/);
  assert.match(router,/MONTH_RE/);
  assert.match(store,/commerce_dashboard_month_series_v1/);
  assert.match(store,/p_month:cleanMonth\(filters\.month\)/);
  assert.match(mig,/grant execute on function public\.%I\(text,integer,text\) to service_role/);
  assert.match(ser,/grant execute on function public\.commerce_dashboard_month_series_v1\(text,text\) to service_role/);
});

test('Ícones de informação explicam a origem dos dados de cada bloco do Dashboard',()=>{
  const d=readFileSync(new URL('../src/commerce-dashboard.jsx',import.meta.url),'utf8');
  for(const k of ['period','kpiRevenue','kpiUnits','kpiTicket','kpiDaily','daily','history','platform','monthly','summary','top','growing','lowconv','cohorts','abc','alerts'])
    assert.match(d,new RegExp('\\n  '+k+":'"));
  assert.match(d,/Importar arquivo/);
  assert.match(d,/<Panel title="Em alta" icon="down" source="growing"/);
  assert.match(d,/<Panel title="Muita visita, pouca venda" icon="eye" source="lowconv"/);
});

test('Período: opção Personalizado abre calendário por ano com os meses que têm vendas',()=>{
  const pk=readFileSync(new URL('../src/commerce-period-picker.jsx',import.meta.url),'utf8');
  const d=readFileSync(new URL('../src/commerce-dashboard.jsx',import.meta.url),'utf8');
  assert.match(pk,/Personalizado…/);
  assert.match(pk,/Ano anterior/);assert.match(pk,/Próximo ano/);
  assert.match(pk,/Meses sem vendas importadas ficam desativados/);
  assert.match(d,/<PeriodPicker days=\{days\} month=\{month\}/);
});

test('Modo privacidade: botão no topo e todos os formatadores de reais passam pela máscara',()=>{
  const r=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
  const priv=r('src/commerce-privacy.js'),app=r('src/commerce-admin-app-v2.jsx');
  assert.match(priv,/ga\.privacy/);assert.match(priv,/useSyncExternalStore/);
  assert.match(app,/Ocultar valores/);assert.match(app,/setPrivate\(!privacy\)/);
  for(const f of ['commerce-dashboard.jsx','commerce-dashboard-charts.jsx','commerce-cohorts.jsx','commerce-ad-manager.jsx','commerce-import-history.jsx','commerce-import-center.jsx','commerce-sales-breakdown.jsx','commerce-price-signal.jsx','commerce-shopee-ads-summary.jsx','commerce-shopee-ads-import.jsx','commerce-shopee-aftercare.jsx','commerce-shopee-unlinked-sales.jsx','commerce-shopee-performance-import.jsx','commerce-ml-performance-import.jsx'])
    assert.match(r('src/'+f),/maskMoney/,f);
  assert.doesNotMatch(r('src/commerce-dashboard.jsx'),/const money=v=>/);
});

test('Dashboard: separa Shopee, ML Antigo e ML Novo', () => {
  const c=readFileSync('src/commerce-dashboard-charts.jsx','utf8');
  const d=readFileSync('src/commerce-dashboard.jsx','utf8');
  assert.match(c,/ML Antigo/);assert.match(c,/ML Novo/);
  assert.match(c,/export function PlatformTable/);assert.match(c,/export function MonthMatrix/);
  assert.match(d,/Comparativo por plataforma/);assert.match(d,/Mês a mês por plataforma/);
});

test('Dashboard: o filtro acompanha o clique até o Painel Comercial', () => {
  assert.match(readFileSync('src/commerce-dashboard.jsx','utf8'),/onOpenTab\(k,\{platform,days,month\}\)/);
  assert.match(readFileSync('src/commerce-commercial-panel.jsx','utf8'),/initialFilter=\{perfOpen\?perfOpen\.filter:null\}/);
});

test('GA: modo noturno com botão e escolha guardada', () => {
  assert.match(readFileSync('src/commerce-theme.js','utf8'),/ga\.theme/);
  assert.match(readFileSync('src/commerce-admin-app-v2.jsx','utf8'),/commerce-theme-btn/);
  assert.match(readFileSync('src/commerce-dark.css','utf8'),/html\.ga-dark/);
});

test('Ícones de informação: texto organizado e atalho para o Histórico de importações', () => {
  const d=readFileSync('src/commerce-dashboard.jsx','utf8');
  assert.match(d,/ndb-info-link/);assert.match(d,/ga:navigate/);
  assert.match(readFileSync('src/commerce-admin-app-v2.jsx','utf8'),/ga:navigate/);
});

test('GA: o conteúdo ocupa a largura do monitor (sem faixa vazia nas laterais)', () => {
  assert.match(readFileSync('src/commerce-admin.css','utf8'),/commerce-admin-page-content:has\(\.ndb-root\)\{max-width:none\}/);
});

test('Curva ABC no Painel Comercial tem altura própria', () => {
  assert.match(readFileSync('src/commerce-dashboard.css','utf8'),/is-explorer \.ndb-chartbox\.fill\{[^}]*height:clamp/);
});

test('Detalhe do produto separa os dados de cada anúncio', () => {
  const m=readFileSync('supabase/migrations/20261028190000_commerce_listing_cohort_detail_v2.sql','utf8');
  assert.match(m,/grant execute on function public\.commerce_listing_cohort_detail_v2\(text,text\) to service_role/);
  assert.doesNotMatch(m,/\b(insert into|update public|delete from|drop )\b/i);
  assert.match(readFileSync('src/commerce-cohorts.jsx','utf8'),/ndb-coh-ltabs/);
});

test('Cadastros por mês: uma linha por anúncio, sem misturar vendas nem variações', () => {
  const m=readFileSync('supabase/migrations/20261028200000_commerce_cohorts_por_anuncio_v2.sql','utf8');
  assert.match(m,/left join sales s on s\.external_listing_id=pr\.lid/);
  assert.doesNotMatch(m,/group by c\.platform, c\.product_ref/);
  assert.match(m,/grant execute on function public\.commerce_listing_cohort_detail_v3\(text,text\) to service_role/);
  assert.match(readFileSync('src/commerce-cohorts.jsx','utf8'),/&listing='\+encodeURIComponent\(item\.listing_id\)/);
});

test('Cadastros por mês: anúncio por linha e variações dentro (Shopee por anúncio, ML por produto)', () => {
  const m=readFileSync('supabase/migrations/20261028210000_commerce_cohorts_anuncio_e_variacoes_v3.sql','utf8');
  assert.match(m,/case when c\.platform='ML' then c\.product_ref else c\.external_listing_id end k/);
  assert.match(m,/grant execute on function public\.commerce_listing_cohort_detail_v4\(text,text\) to service_role/);
  assert.doesNotMatch(m,/\b(insert into|update public|delete from|drop )\b/i);
});

test('Cadastros por mês: ML Antigo e ML Novo são filtrados por conta, nunca juntos', () => {
  const r=readFileSync('src/commerce-admin-router.js','utf8');
  assert.match(r,/account:platform==='ML_ANTIGO'\?'ANTIGO'/);
  assert.doesNotMatch(r,/ML Antigo e ML Novo viram "ML"/);
  const m=readFileSync('supabase/migrations/20261028220000_commerce_cohorts_por_conta_ml_v4.sql','utf8');
  assert.match(m,/c\.product_ref\|\|'\|'\|\|coalesce\(l\.account_code,''\)/);
  assert.match(m,/grant execute on function public\.commerce_listing_cohorts_v4\(text,text\) to service_role/);
});
