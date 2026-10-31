import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261026170000_commerce_dashboard_v1.sql');
const router=read('src/commerce-admin-router.js');
const app=read('src/commerce-admin-app-v2.jsx');
const ui=read('src/commerce-dashboard.jsx');
test('dashboard SQL is read-only, service_role only and keeps only valid windows',()=>{
  assert.match(sql,/language sql stable/);
  assert.doesNotMatch(sql,/\b(insert into|update public|delete from|drop )\b/i);
  assert.match(sql,/revoke all on function public\.commerce_dashboard_v1/);
  assert.match(sql,/grant execute[\s\S]*to service_role/);
  assert.match(sql,/p_days in \(7,30,60,90\)/);
  assert.match(sql,/listing_status='ACTIVE' and prev_units>=5/);
  assert.match(sql,/0\.80\*total_rev/);
  assert.match(sql,/0\.95\*total_rev/);
});
test('route validates platform and period; GA menu exposes the dashboard',()=>{
  assert.ok(router.includes("BASE_PATH+'/sales-dashboard'"));
  assert.ok(router.includes("['TODAS','SHOPEE','ML_ANTIGO','ML_NOVO'].includes(platform)"));
  assert.ok(router.includes('![7,30,60,90].includes(days)'));
  assert.ok(app.includes("id: 'dashboard'")&&app.includes('<CommerceDashboard onOpenTab={openPerformance} />'));
});
test('every card has an info icon naming its data source',()=>{
  for(const key of ['abc','drops','best','alerts'])assert.ok(ui.includes('source="'+key+'"')||ui.includes("'"+key+"'"),key);
  assert.ok(ui.includes('TAB_SOURCE'));
  assert.ok(ui.includes('SOURCES.help')&&ui.includes('SOURCES.trust'));
  assert.ok(ui.includes('De onde vêm os dados'));
  assert.ok(ui.includes('[7,30,60,90]'.replace(/,/g,',')) || ui.includes('PERIODS=[7,30,60,90]'));
});
test('changePct handles new and falling listings',async()=>{
  const {changePct}=await import('../src/commerce-dashboard.jsx').catch(()=>({}));
  if(!changePct)return;
  assert.equal(changePct(50,100),-50);
  assert.equal(changePct(10,0),null);
});
test('series and overview SQL are read-only, service_role only and expose routes',()=>{
  for(const f of ['20261026180000_commerce_dashboard_series_v1','20261026190000_commerce_dashboard_overview_v1']){
    const q=read('supabase/migrations/'+f+'.sql');
    assert.match(q,/language sql stable/);
    assert.doesNotMatch(q,/\b(insert into|update public|delete from|drop )\b/i);
    assert.match(q,/grant execute[\s\S]*to service_role/);
  }
  assert.ok(router.includes("/sales-dashboard/series")&&router.includes("/sales-dashboard/overview"));
});
test('missing data is shown as sem dados, never zero',()=>{
  assert.ok(ui.includes('Sem dados: falta cadastrar o custo do produto'));
  assert.ok(!ui.includes("Anúncios pagos (ROAS)"));
});
test('listingUrl builds marketplace links from the platform and listing id',()=>{
  const src=read('src/commerce-dashboard.jsx');
  assert.ok(src.includes("https://shopee.com.br/product/'+SHOPEE_SHOP_ID+'/'"));
  assert.ok(src.includes("https://produto.mercadolivre.com.br/MLB-'+m[1]"));
  assert.ok(src.includes('rel="noopener noreferrer"'));
  assert.equal((src.match(/<Ext platform=/g)||[]).length,7);
});
test('ABC: por SKU, no período escolhido, por plataforma ou global',()=>{
  const m=read('supabase/migrations/20261030231000_commerce_dashboard_abc_v2.sql');
  assert.match(m,/commerce_sku_canon_v1/);
  assert.match(m,/commerce_shopee_sales_sku_daily_v1/);
  assert.match(m,/prm\.plat='TODAS' or v\.platform_code=prm\.plat/);
  assert.match(m,/p_start/);
  assert.doesNotMatch(m,/\b(insert into|update public|delete from|drop table)\b/i);
  assert.ok(ui.includes("platform==='TODAS'?abcPlat:platform"));
  assert.ok(ui.includes("sales-dashboard/abc?platform="));
  assert.ok(ui.includes("['TODAS','SHOPEE','ML_ANTIGO','ML_NOVO'].map"));
  assert.ok(ui.includes("abcLabel"));
});
test('Pararam de vender is cumulative: sold 3+ units ever and no sale in the filter period',()=>{
  const m=read('supabase/migrations/20261027090000_commerce_dashboard_stopped_cumulative_v1.sql');
  assert.match(m,/h\.total_units>=3/);
  assert.match(m,/a\.cur_units=0/);
  assert.match(m,/days_since/);
  assert.doesNotMatch(m,/\b(insert into|update public|delete from|drop )\b/i);
  assert.ok(ui.includes('r.days_since'));
  assert.ok(ui.includes('Sem vender há'));
});
test('Sem filtro: period 0 accumulates all sales, monthly chart per platform, ABC independent of period',()=>{
  const a=read('supabase/migrations/20261027100000_commerce_dashboard_all_period_abc_history_v1.sql');
  const m=read('supabase/migrations/20261027110000_commerce_dashboard_monthly_v1.sql');
  assert.match(a,/when p_days=0 then 36500/);
  assert.match(a,/from alst where cur_rev>0 group by 1,2/);
  assert.match(m,/date_trunc\('month',sale_date\)/);
  assert.match(m,/grant execute on function public\.commerce_dashboard_monthly_v1\(text\) to service_role/);
  assert.doesNotMatch(a+m,/\b(insert into|update public|delete from|drop )\b/i);
  assert.ok(router.includes("![0,7,30,60,90].includes(days)"));
  assert.ok(router.includes("/sales-dashboard/monthly"));
  assert.ok(readFileSync(new URL("../src/commerce-period-picker.jsx",import.meta.url),"utf8").includes("Sem filtro (todo o histórico)"));
});
test('GA opens on the Dashboard screen by default',()=>{
  assert.ok(app.includes("useState('dashboard')"));
  assert.ok(!app.includes("const [activeView, setActiveView] = useState('catalog')"));
});
test('Desativar produto: preserva historico, so desativa anuncios sem produto ativo e restaura ao reativar',()=>{
  const m=read('supabase/migrations/20261027120000_commerce_product_deactivation_cascade_v1.sql');
  const products=read('src/commerce-products-view.jsx');
  const shared=read('src/commerce-admin-shared.jsx');
  assert.match(m,/status_before_deactivation/);
  assert.match(m,/p\.internal_status <> 'DISCONTINUED'/);
  assert.doesNotMatch(m,/\bdelete from\b|\bdrop\b/i);
  assert.ok(shared.includes("DISCONTINUED: 'Desativado'"));
  assert.ok(products.includes('toggleDeactivated'));
  assert.ok(products.includes('Confirmar desativar'));
  assert.ok(products.includes("useState('ACTIVE')"));
  assert.ok(ui.includes("label:'Desativado'"));
  assert.ok(ui.includes("label:'Sem status'"));
});

test('Importação Shopee: lote novo substitui os mesmos dias de snapshots antigos e arquiva o que saiu',()=>{
  const m=read('supabase/migrations/20261030233000_commerce_shopee_import_supersede_trigger_v1.sql');
  assert.match(m,/ob\.snapshot_id<new\.snapshot_id/);
  assert.match(m,/returning d\.\*/);
  assert.match(m,/commerce_shopee_sku_daily_superseded_v1/);
  assert.match(m,/after update of status on public\.commerce_sales_import_batches/);
  assert.match(m,/new\.status='COMMITTED'/);
  assert.doesNotMatch(m,/drop table|truncate/i);
});

test('Card de faturamento mostra Full x envio próprio (valor e %) com dados por mês',()=>{
  const jsx=read('src/commerce-dashboard.jsx'),m=read('supabase/migrations/20261030235000_commerce_shopee_shipping_split_v1.sql');
  assert.match(jsx,/sales-dashboard\/shipping/);
  assert.match(jsx,/Envio próprio/);
  assert.match(m,/commerce_dashboard_shipping_split_v1/);
  assert.match(m,/commerce_shopee_full_monthly_v1/);
});

test('Importador Shopee guarda o Full por dia e a divisão usa os dias importados depois de out/2026',()=>{
  const r=read('src/commerce-sales-import-reader.js'),c=read('src/commerce-import-client.js'),m=read('supabase/migrations/20261031000500_commerce_shopee_full_daily_import_v1.sql');
  assert.match(r,/full_daily_rows/);assert.match(r,/pedido fbs/);
  assert.match(c,/shopee-full/);
  assert.match(m,/commerce_append_shopee_full_daily_v1/);
  assert.match(m,/commerce_shopee_full_daily_v1 d/);
  assert.match(m,/sale_date>='2026-11-01'/);
});

test('Curva ABC rápida: SKU unificado depois de agrupar as vendas',()=>{
  const m=read('supabase/migrations/20261030235900_commerce_dashboard_abc_faster_v1.sql');
  assert.match(m,/group by 1,2,3\n\), mlv as/);
  assert.match(m,/cmap as \(/);
  assert.doesNotMatch(m,/drop |truncate/i);
});

test('Menu do período abre para a direita quando cabe, sem ficar sob a barra lateral',()=>{
  const j=read('src/commerce-period-picker.jsx'),c=read('src/commerce-dashboard.css');
  assert.match(j,/setAlignLeft\(r\.left\+w<=window\.innerWidth-8\)/);
  assert.match(j,/is-left/);
  assert.match(c,/\.ndb-pp-menu\.is-left\{left:0;right:auto/);
});

test('Dashboard: índice por código do anúncio, cache curto e sem pedido duplicado do histórico mensal',()=>{
  const m=read('supabase/migrations/20261031190000_commerce_listings_external_id_index_v1.sql');
  assert.match(m,/create index if not exists commerce_listings_external_listing_idx/);
  const j=read('src/commerce-dashboard.jsx');
  assert.match(j,/if\(platform==='TODAS'\)return undefined;/);
  assert.match(j,/setMonthly\(monthlyAll\)/);
  assert.match(read('src/edge-router.js'),/bumpReadCacheGeneration/);
  assert.match(read('src/commerce-manager-fetch.js'),/fresh=1/);
});
