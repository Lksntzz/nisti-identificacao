import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {aggregateShopeeExtras,cancelReasonKey,shopeeExtrasColumns} from '../src/ga/commerce-shopee-order-extras.js';
const read=p=>fs.readFileSync(p,'utf8');
const ex=(o={})=>({price_orig:59.9,price_paid:35.9,ship_est:8,ship_paid:2,cashback:1,uf:'São Paulo',...o});

test('extras: preço médio ponderado, mínimo e máximo por dia e SKU',()=>{
  const {order_extras_daily_rows:rows}=aggregateShopeeExtras([
    {order_id:'A',sale_date:'2025-03-01',sku_norm:'X',units:2,extras:ex()},
    {order_id:'B',sale_date:'2025-03-01',sku_norm:'X',units:1,extras:ex({price_paid:41.9})}
  ]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].units,3);
  assert.equal(rows[0].price_paid_sum,113.7);
  assert.equal(rows[0].price_orig_sum,179.7);
  assert.equal(rows[0].price_paid_min,35.9);
  assert.equal(rows[0].price_paid_max,41.9);
  assert.deepEqual(rows[0].uf_units,{'São Paulo':3});
});
test('extras: frete e cashback do pedido só entram em pedido de um único SKU, sem somar linhas repetidas',()=>{
  const {order_extras_daily_rows:rows}=aggregateShopeeExtras([
    {order_id:'A',sale_date:'2025-03-01',sku_norm:'X',units:1,extras:ex()},
    {order_id:'A',sale_date:'2025-03-01',sku_norm:'X',units:1,extras:ex()},
    {order_id:'M',sale_date:'2025-03-01',sku_norm:'X',units:1,extras:ex({ship_est:99})},
    {order_id:'M',sale_date:'2025-03-01',sku_norm:'Y',units:1,extras:ex({ship_est:99})}
  ]);
  const x=rows.find(r=>r.sku_norm==='X'),y=rows.find(r=>r.sku_norm==='Y');
  assert.equal(x.ship_orders,1);
  assert.equal(x.ship_est,8);
  assert.equal(x.ship_paid,2);
  assert.equal(x.cashback_seller,1);
  assert.equal(y.ship_orders,0);
  assert.equal(y.ship_est,0);
});
test('extras: cancelados contam à parte, com motivo, sem entrar em unidades nem preço',()=>{
  const {order_extras_daily_rows:rows}=aggregateShopeeExtras([],[
    {order_id:'C1',sale_date:'2025-03-02',sku_norm:'X',units:2,reason:'Cancelado automaticamente pelo sistema da Shopee. Motivo : Pedido não pago'},
    {order_id:'C2',sale_date:'2025-03-02',sku_norm:'X',units:1,reason:'Cancelado pelo comprador. Motivo : Outros'}
  ]);
  assert.equal(rows[0].units,0);
  assert.equal(rows[0].price_paid_sum,0);
  assert.equal(rows[0].price_paid_min,null);
  assert.equal(rows[0].cancelled_units,3);
  assert.equal(rows[0].cancelled_orders,2);
  assert.deepEqual(rows[0].cancel_reasons,{'sistema: Pedido não pago':2,'comprador: Outros':1});
});
test('extras: motivo de cancelamento e colunas obrigatórias',()=>{
  assert.equal(cancelReasonKey(''),'sem motivo');
  assert.equal(cancelReasonKey('Cancelado pelo comprador. Motivo : Não quero mais comprar'),'comprador: Não quero mais comprar');
  assert.equal(shopeeExtrasColumns(['Status do pedido','Preço original']),null);
  const c=shopeeExtrasColumns(['Preço original','Preço acordado','UF','Cancelar Motivo']);
  assert.equal(c.price_paid,1);assert.equal(c.uf,2);assert.equal(c.ship_est,-1);
});
test('extras: a saída não carrega pedido, comprador nem endereço',()=>{
  const {order_extras_daily_rows:rows}=aggregateShopeeExtras([
    {order_id:'SECRETO123',sale_date:'2025-03-01',sku_norm:'X',units:1,extras:ex()}],[]);
  assert.doesNotMatch(JSON.stringify(rows),/SECRETO123/);
  assert.deepEqual(Object.keys(rows[0]).sort(),['cancel_reasons','cancelled_orders','cancelled_units','cashback_seller','price_orig_sum','price_paid_max','price_paid_min','price_paid_sum','sale_date','ship_est','ship_orders','ship_paid','sku_norm','uf_units','units']);
});
test('extras: leitor, cliente, rota, store e migração estão ligados',()=>{
  const r=read('src/ga/commerce-sales-import-reader.js'),c=read('src/ga/commerce-import-client.js');
  const router=read('src/ga/commerce-admin-router.js'),store=read('src/ga/commerce-supabase-store.js');
  const sql=read('supabase/migrations/20261106120000_commerce_shopee_order_extras_daily_v1.sql');
  assert.match(r,/order_extras_daily_rows/);assert.match(r,/rawCancelled/);
  assert.match(c,/shopee-extras/);assert.match(router,/shopee-extras/);
  assert.match(store,/commerce_append_shopee_order_extras_v1/);
  assert.match(sql,/revoke all on function public\.commerce_append_shopee_order_extras_v1[\s\S]*from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.commerce_append_shopee_order_extras_v1[\s\S]*to service_role/);
  assert.match(sql,/delete from public\.commerce_shopee_order_extras_daily_v1 d/);
  assert.match(sql,/delete from public\.commerce_shopee_full_daily_v1 d/);
  assert.doesNotMatch(sql,/alter table public\.commerce_(sales|shopee_sales)/i);
  assert.doesNotMatch(sql,/create or replace view/i);
});
