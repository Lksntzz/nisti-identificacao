import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseShopeeAftercareSheets} from '../src/commerce-shopee-aftercare-reader.js';

const headings=['ID da Devolução','ID do pedido','Data de criação do pedido','Nome de usuário (Comprador)',
  'Nome do Produto','SKU principal','Nome da variação','SKU da Variação',
  'Tempo de envio de devolução','Status da Devolução / Reembolso',
  'Quantidade de Devoluções','Solução para Retorno e Reembolso','Motivo da Devolução',
  'Observações da Devolução','Quantia total de reembolsos',
  'Status de rastreamento de devolução','Endereço de entrega','Telefone'];
function row(id,sku,status='Aprovada',tracking='Devolução concluída') {
  return [id,'260624U233V9BG','2026-06-23 13:06','comprador',
    'Caderno','PLAN1_BBB','Modelo',sku,'2026-07-01 10:12',status,1,'Retorno e Reembolso',
    'Produto errado','Texto privado','R$29,90',tracking,'Rua privada','99999999999'];
}
const sql=fs.readFileSync('supabase/migrations/20261020185500_commerce_shopee_aftercare_v1.sql','utf8');
const importUi=fs.readFileSync('src/commerce-shopee-aftercare-import.jsx','utf8');
const side=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const ui=fs.readFileSync('src/commerce-shopee-aftercare.jsx','utf8');

test('group multiple product lines under one return id; refund cannot be multiplied',()=>{
  const source=parseShopeeAftercareSheets([{data:[headings,row('2607010HRS4R0MC','PLAN1_BBB'),row('2607010HRS4R0MC','PLAN2_BBB')]}]);
  assert.equal(source.requests.length,1);
  assert.equal(source.rowCount,2);
  assert.equal(source.requests[0].items.length,2);
  assert.equal(source.requests[0].refund_requested,29.9);
  assert.equal(source.statuses.approved,1);
  assert.equal(source.statuses.returnsDelivered,1);
});

test('distinguish withdrawn return request from canceled original order',()=>{
  const source=parseShopeeAftercareSheets([{data:[headings,
    row('2607010HRS4R0MC','ABC1','Solicitação cancelada pelo comprador',''),
    row('2607010HRS4R1MC','ABC2','',null)]}]);
  assert.equal(source.statuses.withdrawn,1);
  assert.equal(source.statuses.other,1);
  assert.equal(source.requests[1].status,'Não informado');
});
test('reject conflicting duplicates and amounts',()=>{
  const x=row('2607010HRS4R0MC','ABC1');
  const y=row('2607010HRS4R0MC','ABC2');y[14]='R$35,90';
  assert.throws(()=>parseShopeeAftercareSheets([{data:[headings,x,y]}]),/conflitantes/);
});

test('never send buyer contact data, freeform observations or shipment tracking IDs',()=>{
  const source=parseShopeeAftercareSheets([{data:[headings,row('2607010HRS4R0MC','ABC1')]}]);
  const json=JSON.stringify(source);
  for(const sensitive of ['comprador','Rua privada','99999999999','Texto privado'])
    assert.ok(!json.includes(sensitive),sensitive);
  assert.match(importUi,/Dados pessoais, endereços e observações livres/);
});
test('isolated service-only tables and non-duplicating reports',()=>{
  assert.match(sql,/enable row level security/g);
  assert.match(sql,/revoke all .* from public,anon,authenticated/);
  assert.match(sql,/to service_role/);
  assert.match(sql,/on conflict\(sha256\) do nothing/);
  assert.match(sql,/distinct on \(r\.return_id\)/);
  assert.match(sql,/having count\(distinct lp\.listing_id\)=1/);
  assert.match(sql,/when own_items=all_items/);
  assert.doesNotMatch(sql,/update public\.commerce_sales|insert into public\.commerce_sales/);
  assert.match(store,/commerce_shopee_aftercare_import_v1/);
  assert.match(store,/commerce_shopee_aftercare_listing_v1/);
  assert.match(router,/commerceImportShopeeAftercare\(env,input\)/);
  assert.match(router,/commerceShopeeAftercareListing\(env,aftercareListing\[1\]\)/);
});
test('Shopee aftercare tab and compact summary show real imported information',()=>{
  assert.match(side,/item\.source==='SHOPEE'\?<CommerceShopeeAftercare listingId=\{item\.id\}\/>/);
  assert.match(side,/aftercareOverview\.counts\.requests/);
  assert.match(ui,/Solicitações identificadas/);
  assert.match(ui,/Valores aprovados atribuíveis/);
  assert.match(ui,/aprovação não comprova/i);
  assert.doesNotMatch(ui,/quantidade de pedidos cancelados confirmados/);
  assert.match(importUi,/readShopeeAftercareFile/);
});
