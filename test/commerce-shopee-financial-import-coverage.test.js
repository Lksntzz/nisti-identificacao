import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {shopeeFinanceColumns,aggregateShopeeFinance} from '../src/commerce-shopee-finance-aggregation.js';
import {shopeeMonthlyImportCoverage} from '../src/commerce-ad-evidence.js';

const make=(order_id,sku_norm,product_revenue,fee,discount=0)=>({
  order_id,sku_norm,sale_date:'2026-04-01',units:1,product_revenue,
  finance:{seller_discount:discount,transaction_fee:fee.transaction,
    commission_net:fee.commission,service_net:fee.service}
});
const charges={commission:3,service:2,transaction:1};

test('finance parser uses ONE seller discount, and net rather than gross commissions/services',()=>{
  const labels=['Desconto do vendedor','Desconto do vendedor','Taxa de comissão bruta',
    'Taxa de comissão líquida','Taxa de serviço bruta','Taxa de serviço líquida',
    'Taxa de transação'];
  assert.deepEqual(shopeeFinanceColumns(labels),{
    seller_discount:0,transaction_fee:6,commission_net:3,service_net:5
  });
  assert.equal(shopeeFinanceColumns(['Número de referência SKU']),null);
});

test('order fees duplicated in repeated SKU lines count once, seller line discount counts per line',()=>{
  const rows=[
    make('order-1','A',20,charges,3),
    make('order-1','A',10,charges,2),
    make('order-2','A',40,charges,4),
    make('order-2','B',60,charges,6)
  ];
  const parsed=aggregateShopeeFinance(rows);
  const d=parsed.finance_daily_rows;
  assert.equal(d.length,1);
  assert.equal(d[0].sku_norm,'A');
  assert.equal(d[0].units,2);
  assert.equal(d[0].orders,1);
  assert.equal(d[0].product_revenue,30);
  assert.equal(d[0].seller_discount,5);
  assert.equal(d[0].commission_net,3);
  assert.equal(d[0].service_net,2);
  assert.equal(d[0].transaction_fee,1);
  const m=parsed.finance_month_rows[0];
  assert.equal(m.orders,2);
  assert.equal(m.units,4);
  assert.equal(m.product_revenue,130);
  assert.equal(m.fee_orders,2);
  assert.equal(m.single_sku_fee_orders,1);
  assert.equal(m.unallocated_orders,1);
  assert.equal(m.unallocated_units,2);
  assert.equal(m.unallocated_revenue,100);
  assert.equal(m.commission_net,6);
  assert.equal(m.service_net,4);
  assert.equal(m.transaction_fee,2);
  assert.equal(m.seller_discount,15);
  assert.deepEqual(parsed.finance_summary,{
    orders:2,fee_orders:2,attributable_orders:1
  });
});

test('inconsistent duplicated fees cannot be attributed to any SKU',()=>{
  const a=make('bad','A',20,charges,1);
  const b=make('bad','A',15,{...charges,commission:9},1);
  const parsed=aggregateShopeeFinance([a,b]);
  assert.equal(parsed.finance_daily_rows.length,0);
  assert.equal(parsed.finance_month_rows.length,0);
  assert.equal(parsed.finance_summary.orders,1);
  assert.equal(parsed.finance_summary.fee_orders,0);
});

test('missing finance columns cannot produce fictitious zero fees',()=>{
  const parsed=aggregateShopeeFinance([{order_id:'A',sku_norm:'SKU',sale_date:'2026-04-01',
    units:1,product_revenue:39.9,finance:null}]);
  assert.equal(parsed.finance_daily_rows.length,0);
  assert.equal(parsed.finance_month_rows.length,0);
});

test('coverage accurately differentiates identified units and current month total',()=>{
  const data={source_kind:'MONTHLY_SKU_PARTIAL',
    imported_month:{period_end:'2026-10-16',units:2647,revenue:96280.66},
    kpis:{month_linked_units:2646,month_linked_revenue:96240.76}};
  const c=shopeeMonthlyImportCoverage(data);
  assert.equal(c.importedUnits,2647);
  assert.equal(c.matchedUnits,2646);
  assert.equal(c.remainingUnits,1);
  assert.equal(c.remainingRevenue,39.9);
  assert.ok(c.percentage>99.96&&c.percentage<99.97);
  assert.equal(c.importedThrough,'2026-10-16');
  assert.equal(c.perListingComplete,false);
  assert.equal(shopeeMonthlyImportCoverage({}),null);
});

test('order finance is staged before sales commit, and activation is always AFTER commit',()=>{
  const reader=fs.readFileSync('src/commerce-sales-import-reader.js','utf8');
  const client=fs.readFileSync('src/commerce-import-client.js','utf8');
  const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
  assert.match(reader,/shopeeFinanceColumns/);
  assert.match(reader,/aggregateShopeeFinance\(raw\)/);
  assert.match(reader,/finance_daily_rows:finance\.finance_daily_rows/);
  assert.match(client,/finance-month/);
  assert.match(client,/finance-daily/);
  assert.ok(client.indexOf("/finance-month")<client.indexOf("phase: 'commit'"));
  assert.match(store,/commerce_append_shopee_finance_daily_v1/);
  assert.match(store,/commerce_activate_shopee_finance_v1/);
  assert.ok(store.indexOf("'commerce_commit_sales_import_v1'")<
    store.indexOf("'commerce_activate_shopee_finance_v1'"));
  assert.match(store,/finance_status='NEEDS_REVIEW'/);
});

test('financial database validates months and preserves service-only access',()=>{
  const sql=fs.readFileSync('supabase/migrations/20261016235500_commerce_shopee_financial_sales_v1.sql','utf8');
  assert.match(sql,/commerce_shopee_finance_stage_daily_v1/);
  assert.match(sql,/commerce_shopee_finance_stage_month_v1/);
  assert.match(sql,/commerce_shopee_finance_current_month_v1/);
  assert.match(sql,/commerce_shopee_listing_finance_v1/);
  assert.match(sql,/v_snapshot.*COMMITTED/);
  assert.match(sql,/i\.units<>s\.units/);
  assert.match(sql,/coalesce\(a\.units,0\)\+i\.unallocated_units<>i\.units/);
  assert.match(sql,/v_batch_ids/);
  assert.match(sql,/source_snapshot_id/);
  assert.match(sql,/security_invoker=true/);
  assert.match(sql,/revoke all on public\.%I from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.%s to service_role/);
  assert.doesNotMatch(sql,/update public\.products|delete from public\.products|update public\.commerce_sales_rows/);
});

test('finance panel does not present estimates as official seller payout',()=>{
  const panel=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
  assert.match(panel,/Taxa de transação/);
  assert.match(panel,/Descontos do vendedor/);
  assert.match(panel,/finance\\.fee_reconciled_subtotal/);
  assert.match(panel,/finance\\.after_identified_fees/);
  assert.match(panel,/não o repasse oficial nem lucro líquido/);
  assert.match(panel,/shopeeMonthlyImportCoverage\(data\)/);
  assert.match(panel,/A cobertura global não comprova ausência de vendas em cada variação/);
});
