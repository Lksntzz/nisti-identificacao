import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261019180000_commerce_order_metrics_v1.sql','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const reader=fs.readFileSync('src/commerce-sales-import-reader.js','utf8');

test('pedidos únicos e ticket mensal usam snapshot vigente, nunca somam linhas de SKU',()=>{
  assert.match(sql,/commerce_sales_summary_rows s/);
  assert.match(sql,/sn\.id=s\.snapshot_id and sn\.is_current/);
  assert.match(sql,/sum\(s\.net_orders\)::bigint orders/);
  assert.match(sql,/round\(s\.sales_revenue\/s\.exact_orders,2\)/);
  assert.match(sql,/order_item_incidents/);
  assert.match(sql,/ORDER_WITH_ITEM_INCIDENCE_NOT_DISTINCT/);
  assert.match(sql,/when s\.days=0 then 'MONTHLY_IMPORTED'/);
  assert.doesNotMatch(sql,/round\(.*order_item_incidents.*\).*ticket_average/i);
});

test('pedidos por anúncio não fingem serem distintos e Shopee agrega do SKU real',()=>{
  assert.match(sql,/commerce_current_sales_listing_daily_v1/);
  assert.match(sql,/join public\.commerce_shopee_sku_owner_reviewed_v1 owner/);
  assert.match(sql,/owner\.source_sku_norm=public\.commerce_nisti_sku_norm_v1\(r\.sku_norm\)/);
  assert.match(sql,/'exact_orders',null/);
  assert.match(sql,/'ticket_average',null/);
  assert.match(ui,/Pedidos com item/);
  assert.match(ui,/Receita por pedido com item/);
  assert.match(ui,/não ticket médio exato do anúncio/);
});

test('taxas e eventos pós-venda ausentes não são exibidos como zero',()=>{
  assert.match(sql,/'cancelled_orders',null/);
  assert.match(sql,/'returned_orders',null/);
  assert.match(sql,/'refunded_orders',null/);
  assert.match(sql,/'cancellation_rate',null/);
  assert.match(sql,/NO_POSTSALE_EVENTS_IMPORTED/);
  assert.match(ui,/Cancelamentos confirmados/);
  assert.match(ui,/Devoluções confirmadas/);
  assert.match(ui,/Reembolsos realizados/);
  assert.match(ui,/Não importado/);
  assert.match(reader,/if \(!isConfirmedShopeeOrder/);
});

test('API tem autenticação administrativa existente e recusa filtros inválidos',()=>{
  assert.match(store,/commerce_order_metrics_v1/);
  assert.match(router,/const orderMetricsPath=pathname\.match/);
  assert.match(router,/commerceOrderMetrics\(env/);
  assert.match(router,/days===0&&!/);
  assert.match(sql,/security invoker set search_path=public/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql,/(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.commerce_sales_/i);
});

test('dashboard distingue o ticket do mês e referência provisória das janelas',()=>{
  assert.match(ui,/Pedidos distintos importados/);
  assert.match(ui,/Ticket médio bruto/);
  assert.match(ui,/Ocorrências de pedido com item/);
  assert.match(ui,/reference_per_item_order/);
  assert.match(ui,/ordersSummary\.platform\.orders/);
  assert.match(ui,/!=null/);
});
