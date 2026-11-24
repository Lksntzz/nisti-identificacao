import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCards, salesCard, ordersCard, linkCard, reportCards, catalogCard, priceStockCard, presetPeriod, validPeriod } from '../src/ga/commerce-data-quality-logic.js';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261124140000_commerce_data_quality_v1.sql');
const router=read('src/ga/commerce-admin-router.js');
const store=read('src/ga/commerce-supabase-store.js');
const app=read('src/ga/commerce-admin-app-v2.jsx');
const ui=read('src/ga/commerce-data-quality.jsx');

const base=(over={})=>({platform:'SHOPEE',period:{start:'2026-10-01',end:'2026-10-31',today:'2026-11-24'},
  sales:{freshness:'DESATUALIZADO',days_behind:5,last_sale_day:'2026-11-19',status:'PARCIAL',requested_days:31,complete_days:25,partial_days:1,
    days_with_records_unverified:2,days_without_information:3,missing_ranges:[{start:'2026-10-03',end:'2026-10-04',days:2},{start:'2026-10-09',end:'2026-10-09',days:1}],
    note:'Venda em todos os dias não prova que todos os pedidos foram importados.',
    reconciliation:{status:'CONCILIADO_INTERNAMENTE',months_checked:2,months_ok:2,divergent_months:[]},
    orders:[{month:'2026-10-01',orders:100,verified:true,reported_in_summary:100},{month:'2026-09-01',orders:null,verified:false,reported_in_summary:90}]},
  reports:[],catalog:{freshness:'ATUALIZADO',listings:5,listings_never_checked:0},price_stock:{},open_batches:[],...over});

test('SQL: somente leitura, sem tabela nova, só service_role, limites do dono e conciliação interna',()=>{
  assert.match(sql,/language plpgsql stable security invoker/);
  assert.doesNotMatch(sql,/\b(insert into|update public|delete from|create table|drop |alter table|truncate)\b/i);
  assert.match(sql,/revoke all on function public\.commerce_data_quality_v1\(text, date, date, boolean\) from public, anon, authenticated/);
  assert.match(sql,/grant execute[\s\S]*to service_role/);
  assert.match(sql,/> 1 then 'DESATUALIZADO'/); assert.match(sql,/> 30 then 'DESATUALIZADO'/); assert.match(sql,/> 7 then 'DESATUALIZADO'/);
  assert.match(sql,/commerce_sales_reconcile_v2/); assert.match(sql,/commerce_sales_month_orders_v2/); assert.match(sql,/commerce_shopee_reconciliation_v1/);
  assert.match(sql,/não conferido no marketplace/); assert.match(sql,/'daily_coverage_proven', false/);
});
test('rota valida plataforma/datas, não usa cache; store chama a função direto',()=>{
  assert.ok(router.includes("BASE_PATH+'/data-quality'"));
  assert.ok(router.includes("['SHOPEE','ML_ANTIGO','ML_NOVO'].includes(platform)")&&!/data-quality[\s\S]{0,400}'TODAS'/.test(router));
  assert.ok(router.includes('1100'));
  const fn=store.slice(store.indexOf('export async function commerceDataQuality'),store.indexOf('export async function commerceSalesImportHistory'));
  assert.match(fn,/commerce_data_quality_v1/); assert.doesNotMatch(fn,/cached_read/);
  assert.ok(fn.includes('response_ms'),'mede o tempo de resposta');
});
test('menu e tela: entrada Qualidade dos dados, sem nota geral, sem apagar nem corrigir',()=>{
  assert.ok(app.includes("id: 'quality'")&&app.includes('<CommerceDataQuality />'));
  assert.doesNotMatch(ui.replace(/^\/\/.*$/gm,''),/nota geral|score|pontuação/i);
  assert.doesNotMatch(ui,/method:\s*'(POST|PUT|DELETE|PATCH)'/);
  assert.ok(ui.includes('Ação recomendada')&&ui.includes('não prova'));
});
test('cartão de vendas separa atualização, cobertura e conciliação: conciliado e desatualizado ao mesmo tempo',()=>{
  const c=salesCard(base());
  const by=Object.fromEntries(c.dims.map(d=>[d.label,d]));
  assert.equal(by['Atualização'].value,'Desatualizado'); assert.equal(by['Cobertura'].value,'Parcial'); assert.equal(by['Conciliação'].value,'Conciliado internamente');
  assert.ok(c.actions.some(a=>a.includes('19/11/2026')));
  assert.ok(c.actions.some(a=>a.includes('03/10/2026 a 04/10/2026')&&a.includes('09/10/2026')));
  assert.ok(c.notes.some(n=>n.includes('não conferido no marketplace')));
  assert.ok(c.lines.some(([k,v])=>k==='Dias sem informação'&&v==='3'));
});
test('ausência não vira zero: sem dados mostra "Sem informação" e "—"',()=>{
  const c=salesCard({sales:{freshness:'SEM_INFORMACAO',status:'SEM_INFORMACAO',requested_days:5,complete_days:0,partial_days:0,days_with_records_unverified:0,days_without_information:5,missing_ranges:[{start:'2026-10-01',end:'2026-10-05',days:5}],reconciliation:{status:'SEM_INFORMACAO'}}});
  assert.ok(c.dims.every(d=>d.value==='Sem informação'));
  assert.equal(c.lines.find(([k])=>k==='Último dia com venda registrada')[1],'—');
  assert.equal(c.lines.find(([k])=>k.startsWith('Meses conferidos'))[1],'—');
});
test('pedidos históricos sem chave aparecem como informados e não verificados',()=>{
  const c=ordersCard(base());
  assert.ok(c.lines.some(([k,v])=>k==='09/2026'&&v.includes('Informado')&&v.includes('não verificado')));
  assert.equal(c.dims[0].value,'Parcial');
});
test('ML: vendas sem anúncio são informativas, incluídas nos totais, sem presumir inativo',()=>{
  const c=linkCard({ml_unlinked_sales:{severity:'INFORMATIVO',listings_with_sales:393,listings_without_registered_listing:196,units_without_registered_listing:2143,
    revenue_without_registered_listing:108762.28,total_units:9000,total_revenue:590034.01,pct_revenue:18.43,pct_units:23.8,note:'incluídas'}});
  assert.equal(c.dims[0].value,'Informativo');
  assert.ok(c.lines.some(([k,v])=>k==='Receita'&&v.includes('18,43%')));
  assert.ok(c.lines.some(([k])=>k.includes('incluem essas vendas')));
  assert.ok(c.actions[0].includes('Não se presume que estejam inativos'));
});
test('relatórios: período não é cobertura diária; sobrepostos e Ads do ML sem fonte',()=>{
  const cards=reportCards({reports:[
    {kind:'ADS',reports:2,freshness:'DESATUALIZADO',last_period_end:'2026-10-20',days_since_period_end:35,period_overlaps_requested:false,overlapping_report_pairs:1,daily_coverage_proven:false},
    {kind:'POS_VENDA',reports:0,freshness:'SEM_INFORMACAO',period_overlaps_requested:null},
    {kind:'ADS_ML',reports:0,freshness:'SEM_INFORMACAO'}]});
  assert.ok(cards[0].actions.some(a=>a.includes('35 dias'))&&cards[0].actions.some(a=>a.includes('sobrepostos')));
  assert.ok(cards[0].notes[0].includes('não é cobertura diária'));
  assert.equal(cards[1].dims[1].value,'Sem informação'); assert.deepEqual(cards[1].lines,[]);
  assert.ok(cards[2].actions[0].includes('Nenhuma ação possível'));
});
test('catálogo, preço e estoque ficam separados e estoque é foto',()=>{
  const c=catalogCard({catalog:{freshness:'DESATUALIZADO',days_since_last_check:8,listings:10,listings_never_checked:2}});
  assert.ok(c.actions.some(a=>a.includes('8 dias')&&a.includes('limite 7')));
  const p=priceStockCard({price_stock:{registered_price:{status:'DISPONIVEL_FOTO',variations:442,variations_with_price:442},realized_price:{status:'DISPONIVEL',listings_with_units:3},stock:{status:'DISPONIVEL_FOTO',variations_with_stock:442}}});
  assert.deepEqual(p.dims.map(d=>d.label),['Preço cadastrado','Preço realizado','Estoque']);
  assert.ok(p.dims[2].value.includes('foto do catálogo'));
});
test('buildCards não cria nota geral e tolera resposta vazia; períodos',()=>{
  assert.deepEqual(buildCards(null),[]);
  assert.ok(!buildCards(base()).some(c=>/nota|score/i.test(c.title)));
  assert.equal(validPeriod('2026-10-05','2026-10-01'),'A data inicial não pode ser depois da final.');
  assert.equal(validPeriod('2022-01-01','2026-11-24').includes('1100'),true);
  assert.equal(validPeriod('2026-10-01','2026-10-31'),'');
  assert.deepEqual(presetPeriod('7',new Date(2026,10,24)),{start:'2026-11-18',end:'2026-11-24'});
  assert.deepEqual(presetPeriod('month',new Date(2026,10,24)),{start:'2026-11-01',end:'2026-11-24'});
});
