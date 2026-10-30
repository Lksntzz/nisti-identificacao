import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('Comparação Anual reformulada mantém a navegação do GA e o Painel Categorias',()=>{
  const entry=read('src/commerce-admin-app-v2.jsx');
  const annual=read('src/commerce-annual-compare.jsx');
  const guided=read('src/commerce-annual-guided.jsx');
  for(const label of ['Painel Comercial','Comparação anual','Categorias'])assert.ok(entry.includes(label));
  assert.match(annual,/GuidedAnnualCompare/);
  for(const label of ['Unidades no ano','Meses em alta \/ queda','Maior ganho \/ maior perda','Anúncios em queda no mês',
    'Evolução mensal de unidades vendidas','Investigação do mês','Desempenho semanal','Produtos da semana',
    'Mais vendidos','Mais cresceram','Mais caíram','Sem histórico','Ver dias','Gráfico','Tabela'])
    assert.ok(guided.includes(label),'Rótulo ausente: '+label);
  assert.doesNotMatch(guided,/Projeção de |Preço médio por unidade|Receita /);
});

test('interações usam séries e produtos reais, nunca resultados inventados',()=>{
  const guided=read('src/commerce-annual-guided.jsx');
  assert.match(guided,/fetchCommercialManager\(path/);
  assert.match(guided,/annual-days/);
  assert.match(guided,/cleanRows\(dayState\.data\?\.days\)\.filter/);
  assert.match(guided,/d\.cur==null\?'—'/);
  assert.match(guided,/d\.base==null\?'—'/);
  assert.match(guided,/annual-period-products/);
  assert.match(guided,/setWeek\(n\)/);
  assert.match(guided,/setProductTab\('down'\)/);
  assert.match(guided,/statusOf\(r\)/);
  assert.match(guided,/Sem vendas em \{baseYear\}/);
  assert.doesNotMatch(guided,/08\/06\s+165\s+210/);
});

test('rota de dias valida plataforma, período, anos e usa RPC somente leitura',()=>{
  const router=read('src/commerce-admin-router.js');
  const store=read('src/commerce-supabase-store.js');
  const sql=read('supabase/migrations/20261029170000_commerce_annual_days_v1.sql');
  assert.match(router,/sales-compare\/annual-days/);
  assert.match(router,/base!==year-1/);
  assert.match(store,/commerce_annual_days_v1/);
  assert.match(sql,/language sql stable/);
  assert.match(sql,/revoke all on function public\.commerce_annual_days_v1[\s\S]*from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.commerce_annual_days_v1[\s\S]*to service_role/);
  assert.match(sql,/left join scoped cur/);
  assert.match(sql,/left join scoped prev/);
  assert.doesNotMatch(sql,/\b(insert into|update public\.|delete from|truncate table)\b/i);
});

test('períodos, carregamento cancelável e classificação sem inventar lançamento',()=>{
  const g=read('src/commerce-annual-guided.jsx');
  assert.match(g,/PeriodPicker/);
  assert.match(g,/periods=\{\[7,30,60,90\]\}/);
  assert.match(g,/monthData\.platform===filters\.platform/);
  assert.match(g,/controller\.abort\(\)/);
  assert.match(g,/mesmo intervalo de /);
  assert.match(g,/data de criação não confirmada/);
  assert.match(g,/não significa que o anúncio foi criado/);
  assert.match(g,/annual-month-listings/);
});


test('cards anuais compactos mantêm os dados e possuem identificação visual',()=>{
  const g=read('src/commerce-annual-guided.jsx');
  const css=read('src/commerce-annual-guided.css');
  assert.match(g,/function InsightIcon\(/);
  assert.match(g,/function MiniBars\(/);
  assert.match(g,/icon="units" spark=\{windowMode\?null:allPeriods\}/);
  assert.match(g,/icon="months" spark=\{allPeriods\}/);
  assert.match(g,/icon="extremes"/);
  assert.match(g,/icon="alerts"/);
  assert.match(css,/\.ga-y-overview-card\{min-height:108px/);
  assert.match(css,/\.ga-y-bars-chart\{min-height:225px/);
  assert.match(css,/\.ga-y-overview-title>\.ga-y-title-text/);
});

test('avisos podem ser fechados sem suprimir a detecção de dados incompletos',()=>{
  const g=read('src/commerce-annual-guided.jsx');
  const css=read('src/commerce-annual-guided.css');
  assert.match(g,/function DismissibleWarning\(/);
  assert.match(g,/aria-label=\{label\}/);
  assert.match(g,/dismissedWarnings\['stale:'\+asOf\]/);
  assert.match(g,/dismissedWarnings\['coverage:'\+filters\.platform\+':'\+baseYear\]/);
  assert.match(g,/onClose=\{\(\)=>setDismissedWarnings/);
  assert.match(css,/\.ga-y-warning-dismissible>button/);
});

test('produto diferencia SKU, coleção e anúncio apenas com identificação confirmada',()=>{
  const g=read('src/commerce-annual-guided.jsx');
  assert.match(g,/const meta=\[label\.collection,r\.category,r\.sku,ad\?\.id\?'ID '\+ad\.id:null\]/);
  assert.match(g,/ga-y-product-avatar/);
  assert.match(g,/title=\{meta\}/);
  assert.match(g,/Com histórico/);
  assert.match(g,/Sem histórico/);
  assert.doesNotMatch(g,/<img[^>]+src=["']https?:/);
});


test('comparação anual mantém gráfico e investigação alinhados sem vão antes dos produtos',()=>{
  const g=read('src/commerce-annual-guided.jsx');
  const css=read('src/commerce-annual-guided.css');
  assert.match(g, /className=\{"ga-y-section ga-y-months"\+\(view==="chart"\?" is-chart":""\)\}/);
  assert.match(css, /\.ga-y-body\{align-items:stretch;gap:9px\}/);
  assert.match(css, /\.ga-y-months\.is-chart \.ga-y-bars-chart\{flex:1 1 auto;min-height:225px\}/);
  assert.match(css, /\.ga-y-months\.is-chart \.ga-y-bar-columns\{height:auto;min-height:158px;flex:1 1 auto\}/);
  assert.match(css, /\.ga-y-products-body\{align-items:start\}/);
});
test('busca de SKU fica dentro de Produtos do mês para alinhar os painéis inferiores',()=>{
  const g=read('src/commerce-annual-guided.jsx');
  const css=read('src/commerce-annual-guided.css');
  assert.match(g,/function ProductPanel\(\{[^}]+query,setQuery/);
  assert.match(g,/ga-y-product-head-tools/);
  assert.match(g,/history=\{history\} setHistory=\{setHistory\} query=\{query\} setQuery=\{setQuery\}/);
  assert.doesNotMatch(g,/Localizar SKU nas listas/);
  assert.match(css,/\.ga-y-product-left\{gap:0\}/);
});


test('Produtos do mês apresenta anúncios, suas variações e fonte sem duplicação',()=>{
  const g=read('src/commerce-annual-guided.jsx');
  const css=read('src/commerce-annual-guided.css');
  const router=read('src/commerce-admin-router.js');
  const store=read('src/commerce-supabase-store.js');
  const sql=read('supabase/migrations/20261030123200_commerce_annual_month_listings_v1.sql');
  assert.match(g,/function MonthlyListingRows/);
  assert.match(g,/Anúncios de \{MONTHS\[month-1\]\}/);
  assert.match(g,/aria-label=\{\(expanded\?'Fechar':'Ver'\)\+' variações do anúncio '/);
  assert.match(g,/ga-y-variation-table/);
  assert.match(g,/variants\.map/);
  assert.match(g,/recorded=v.recorded!==false/);
  assert.match(g,/Sem registro/);
  assert.match(sql,/null::bigint cur,null::bigint base,false recorded/);
  assert.match(g,/annual-month-listings/);
  assert.match(g,/setListingPage/);
  assert.match(g,/setTimeout\(\(\)=>setListingSearch\(query\),350\)/);
  assert.match(css,/\.ga-y-variation-table/);
  assert.match(router,/sales-compare\/annual-month-listings/);
  assert.match(store,/commerce_annual_month_listings_v1/);
  assert.match(sql,/commerce_current_sales_listing_daily_v1/);
  assert.match(sql,/group by v\.platform_code,v\.external_listing_id,public\.commerce_sku_canon_v1/);
  assert.match(sql,/revoke all on function public\.commerce_annual_month_listings_v1[\s\S]*from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.commerce_annual_month_listings_v1[\s\S]*to service_role/i);
  assert.doesNotMatch(sql,/(\binsert into\b|\bdelete from\b|\bupdate public\.)/i);
});


test('ganho e perda são explicitamente do ano selecionado contra o ano-base',()=>{
  const g=read('src/commerce-annual-guided.jsx');
  const css=read('src/commerce-annual-guided.css');
  assert.match(g,/Ganho de \{year\}/);
  assert.match(g,/Perda de \{year\}/);
  assert.match(g,/\{year\}: \{fmt\(best\.cur\)\} · \{baseYear\}: \{fmt\(best\.base\)\}/);
  assert.match(g,/\{year\}: \{fmt\(worst\.cur\)\} · \{baseYear\}: \{fmt\(worst\.base\)\}/);
  assert.match(g,/\{year\} comparado com \{baseYear\} · unidades vendidas/);
  assert.match(g,/ranked\.filter\(p=>p\.diff>0\)/);
  assert.match(g,/ranked\.filter\(p=>p\.diff<0\)/);
  assert.match(g,/baseAvailable&&best/);
  assert.match(g,/baseAvailable&&worst/);
  assert.match(css,/\.ga-y-gain-loss/);
});


test('investigação do mês reproduz os três indicadores e semanas comparativas da referência',()=>{
  const g=read('src/commerce-annual-guided.jsx');
  const css=read('src/commerce-annual-guided.css');
  assert.match(g,/ga-y-investigation-metrics/);
  assert.match(g,/Resultado do mês/);
  assert.match(g,/Semanas do mês/);
  assert.match(g,/Diferença · \{year\} vs\. \{baseYear\}/);
  assert.match(g,/ga-y-comparison-weeks/);
  assert.match(g,/ga-y-week-mini-bars/);
  assert.match(g,/ga-y-week-chevron/);
  assert.match(g,/Selecionar mês da investigação/);
  assert.match(g,/Ver dias do mês/);
  assert.match(css,/\.ga-y-investigation-metrics\{display:grid;grid-template-columns/);
  assert.match(css,/\.ga-y-week-mini-bars i\.is-base/);
  assert.match(css,/\.ga-y-week-mini-bars i\.is-current/);
});

test('dias do mês são carregados sob demanda sem inventar dias zerados',()=>{
  const g=read('src/commerce-annual-guided.jsx');
  assert.match(g,/function MonthDaysPanel/);
  assert.match(g,/Promise\.all\(weekNumbers\.map/);
  assert.match(g,/annual-days\?platform=/);
  assert.match(g,/controller\.abort\(\)/);
  assert.match(g,/showMonthDays&&<MonthDaysPanel/);
  assert.match(g,/d\.base==null\?'—'/);
  assert.match(g,/d\.cur==null\?'—'/);
  assert.match(g,/Sem dados semanais disponíveis/);
});
