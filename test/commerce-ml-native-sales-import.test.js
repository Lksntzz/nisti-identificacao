import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  detectMercadoLivreVendasBrHeader,
  parseMercadoLivreSaleDate,
  parseMercadoLivreVendasBr
} from '../src/commerce-ml-native-sales-reader.js';

const header = [
  'N.º de venda','Data de venda','Depósito','Estado','Descrição do status',
  'Pacote de diversos produtos','Pertence a um kit','Unidades','Receita por produtos (BRL)',
  'Receita por acréscimo no preço (pago pelo comprador)',
  'Taxa de parcelamento equivalente ao acréscimo',
  'Tarifa de venda e impostos (BRL)','Receita por envio (BRL)','Tarifas de envio (BRL)',
  'Custo de envio por troca de produto','Custo de envio com base nas medidas e peso declarados',
  'Custo por diferenças nas medidas e no peso do pacote','Descontos e bônus',
  'Cancelamentos e reembolsos (BRL)','Total (BRL)',
  'Mês de faturamento das suas tarifas','Pedido de compra','Venda por publicidade',
  'SKU','# de anúncio','Loja oficial','Título do anúncio','Variação',
  'Preço unitário de venda do anúncio (BRL)'
];
function row({id,day,status='Entregue',sku='',ad='',qty=null,price=null,unit=null}) {
  const cells=Array.from({length:29},()=>null);
  cells[0]=id;cells[1]=day;cells[3]=status;cells[7]=qty;
  cells[8]=price;cells[23]=sku;cells[24]=ad;cells[26]='Agenda NISTI';cells[27]='Capa 01';cells[28]=unit;
  return cells;
}
const date='15 de outubro de 2026 17:40 hs.';
const workbook=[{
  sheet:'Vendas BR',
  data:[
    ['Vendas BR'],['Neste relatório você encontra informações'],[],
    ['Não foi possível exibir alguns dados. Por favor, tente criar o Excel de vendas novamente.'],
    [],['Vendas'],header,
    row({id:'P1',day:date,status:'Pacote de 2 produtos',price:69.8}),
    row({id:'I1',day:date,status:'Entregue',sku:'AGMT27_A_BBB',ad:'MLB1',qty:1,unit:34.9}),
    row({id:'I2',day:date,status:'Entregue',sku:'AGMT27_B_BBB',ad:'MLB2',qty:1,unit:34.9}),
    row({id:'I3',day:date,status:'Cancelada pelo comprador',sku:'AGMT27_C_BBB',ad:'MLB3',qty:1,price:39.9,unit:39.9}),
    row({id:'I4',day:date,status:'Entregue',sku:'AGMT27_A_BBB',ad:'MLB1',qty:2,price:69.8,unit:34.9}),
    row({id:'I4',day:date,status:'Entregue',sku:'AGMT27_A_BBB',ad:'MLB1',qty:2,price:69.8,unit:34.9}),
    row({id:'I5',day:'14 de outubro de 2026 10:20 hs.',status:'A caminho',sku:'AGMT27_B_BBB',ad:'MLB2',qty:1,price:34.9,unit:34.9})
  ]
}];

test('official Vendas BR header detected at row 7 regardless of its help lines',()=>{
  const x=detectMercadoLivreVendasBrHeader(workbook[0].data);
  assert.equal(x.rowIndex,6);
  assert.equal(x.columns.sku,23);
  assert.equal(x.columns.listing,24);
  assert.equal(x.columns.revenue,8);
  assert.equal(x.columns.order,0);
});

test('Portuguese sale timestamp is parsed to correct ISO date and invalid dates rejected',()=>{
  assert.equal(parseMercadoLivreSaleDate('15 de outubro de 2026 17:40 hs.'),'2026-10-15');
  assert.equal(parseMercadoLivreSaleDate('1 de janeiro de 2026 08:15 hs.'),'2026-01-01');
  assert.equal(parseMercadoLivreSaleDate('32 de outubro de 2026'),null);
});

test('parent package is not double-counted; item revenue is reconstructed from verified prices; cancelled excluded',()=>{
  const d=parseMercadoLivreVendasBr(workbook,'ML_ANTIGO','vendas.xlsx','hash',100);
  assert.equal(d.platform_code,'ML_ANTIGO');
  assert.equal(d.summary.accepted_sales_rows,4);
  assert.equal(d.summary.package_summaries,1);
  assert.equal(d.summary.package_items_recovered,2);
  assert.equal(d.summary.cancelled_or_returned,1);
  assert.equal(d.summary.duplicate_items,1);
  assert.equal(d.summary.source_warning,true);
  assert.equal(d.summary.units,5);
  assert.equal(d.summary.product_revenue,174.5);
  assert.equal(d.summary.net_orders,3);
  assert.equal(d.summary.period_count,2);
  assert.equal(d.listing_rows.length,3);
  assert.deepEqual(
    d.listing_rows.filter(r=>r.sale_date==='2026-10-15').map(r=>r.external_listing_id),
    ['MLB1','MLB2']
  );
  assert.equal(d.listing_rows.find(r=>r.external_listing_id==='MLB1').units,3);
  assert.equal(d.listing_rows.find(r=>r.external_listing_id==='MLB1').product_revenue,104.7);
  assert.equal(d.data_through,'2026-10-15');
  assert.equal(d.summaries.find(x=>x.period_key==='2026-10-15').net_orders,2);
  assert.equal(d.summaries.find(x=>x.period_key==='2026-10-15').product_revenue,139.6);
  assert.equal(d.rows.every(r=>r.period_start===r.period_end),true);
  assert.equal(d.rows.every(r=>r.period_key===r.period_start),true);
  assert.equal(d.rows.every(r=>r.sku_norm && r.orders_with_item>=1),true);
});

test('package values are verified, mismatched parents cannot be imported',()=>{
  const broken=JSON.parse(JSON.stringify(workbook));
  broken[0].data[7][8]=70.9;
  assert.throws(
    ()=>parseMercadoLivreVendasBr(broken,'ML_ANTIGO','vendas.xlsx','hash',100),
    /Importação bloqueada: Pacote na linha 8/
  );
});

test('sensitive shopper and shipping fields are not persisted in staged sales',()=>{
  const d=parseMercadoLivreVendasBr(workbook,'ML_ANTIGO','vendas.xlsx','hash',100);
  assert.equal(d.rows.every(row=>!('buyer' in row||'address' in row||'cpf' in row)),true);
  const sql=fs.readFileSync('supabase/migrations/20260928205021_commerce_sales_import_pipeline_v1.sql','utf8');
  assert.match(sql,/commerce_sales_import_stage_rows/);
  const reader=fs.readFileSync('src/commerce-sales-import-reader.js','utf8');
  assert.match(reader,/detectMercadoLivreVendasBrHeader/);
  assert.match(reader,/parseMercadoLivreVendasBr\(workbook,platformCode/);
});
