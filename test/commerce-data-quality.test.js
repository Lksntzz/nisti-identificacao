import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCards, salesCard, ordersCard, linkCard, reportCards, catalogCard, priceStockCard, batchesCard, presetPeriod, validPeriod, requestKey, isCurrentResult } from '../src/ga/commerce-data-quality-logic.js';
import { setPrivate, MONEY_MASK } from '../src/ga/commerce-privacy.js';
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
    orders:[{month:'2026-10-01',orders:100,basis:'CHAVE',verified_by_key:true,coverage:'COMPLETA',days_by_key:31,days_by_summary:0,days_expected:31},{month:'2026-09-01',orders:90,basis:'RESUMO_HISTORICO',verified_by_key:false,coverage:'COMPLETA',days_by_key:0,days_by_summary:30,days_expected:30}]},
  reports:[],catalog:{freshness:'ATUALIZADO',listings:5,listings_never_checked:0},price_stock:{},open_batches:[],...over});

test('SQL: somente leitura, sem tabela nova, só service_role, limites do dono e conciliação interna',()=>{
  assert.match(sql,/language plpgsql stable security invoker/);
  assert.doesNotMatch(sql,/\b(insert into|update public|delete from|create table|drop |alter table|truncate)\b/i);
  assert.match(sql,/revoke all on function public\.commerce_data_quality_v1\(text, date, date, boolean\) from public, anon, authenticated/);
  assert.match(sql,/grant execute[\s\S]*to service_role/);
  assert.match(sql,/> 1 then 'DESATUALIZADO'/); assert.match(sql,/> 30 then 'DESATUALIZADO'/); assert.match(sql,/<= 7/);
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
test('pedidos: separa chave, resumo histórico, misto, parcial e sem informação; informa contagem por dia',()=>{
  const c=ordersCard(base());
  assert.ok(c.lines.some(([k,v])=>k==='09/2026'&&v.includes('resumo histórico')&&v.includes('não verificado por chave')));
  assert.ok(c.lines.some(([k,v])=>k==='10/2026'&&v.includes('contados por dia')&&v.includes('chaves')));
  assert.equal(c.dims[0].value,'Parcial ou informado');
  assert.ok(c.notes.some(n=>/por dia/i.test(n)));
  const all=ordersCard({sales:{orders:[{month:'2026-10-01',orders:5,basis:'CHAVE',verified_by_key:true,coverage:'COMPLETA',days_by_key:31,days_expected:31}]}});
  assert.equal(all.dims[0].value,'Por chave');
  const mix=ordersCard({sales:{orders:[{month:'2026-08-01',orders:9,basis:'MISTO',verified_by_key:false,coverage:'PARCIAL',days_by_key:1,days_by_summary:1,days_expected:31},
    {month:'2026-07-01',orders:null,basis:'SEM_INFORMACAO',verified_by_key:false,coverage:'SEM_INFORMACAO',days_by_key:0,days_by_summary:0,days_expected:31}]}});
  assert.ok(mix.lines[0][1].includes('base mista')&&mix.lines[0][1].includes('cobertura parcial: 2 de 31'));
  assert.ok(mix.lines[1][1].startsWith('Sem informação'));
  assert.ok(mix.actions.length===3,'resumo histórico, sem informação e parcial');
  assert.ok(!c.actions.some(a=>/aplique|reimporte tudo/i.test(a)));
});
test('GA-011: COMPLETO é só cobertura; resíduo inexplicado nunca aparece como conciliação aprovada',()=>{
  const bad=linkCard({ga011_shopee:{coverage_status:'COMPLETO',reconciliation_status:'DIVERGENTE',explained:false,residual_units:3,residual_revenue:12.5,unmatched_sku_count:0,reconciled_pct:{revenue:99,units:99},coverage:{source_missing_days:0}}});
  const by=Object.fromEntries(bad.dims.map(d=>[d.label,d]));
  assert.equal(by['Cobertura de registros'].value,'Completa'); assert.equal(by['Conciliação'].value,'Divergente');
  assert.ok(bad.actions[0].includes('sem explicação')&&bad.actions[0].includes('Não considere conciliado'));
  assert.ok(bad.lines.some(([k,v])=>k==='Diferença explicada'&&v==='Não'));
  const ok=linkCard({ga011_shopee:{coverage_status:'COMPLETO',reconciliation_status:'CONCILIADO_INTERNAMENTE',explained:true,residual_units:0,residual_revenue:0,unmatched_sku_count:0,coverage:{source_missing_days:0}}});
  assert.equal(Object.fromEntries(ok.dims.map(d=>[d.label,d]))['Conciliação'].value,'Conciliado internamente');
});
test('ML sem vendas no período: Sem informação, sem totais zerados',()=>{
  const c=linkCard({ml_unlinked_sales:{severity:'SEM_INFORMACAO',status:'SEM_INFORMACAO',note:'Nenhuma venda registrada'}});
  assert.equal(c.dims[0].value,'Sem informação'); assert.deepEqual(c.lines,[]);
  assert.ok(!c.lines.some(([,v])=>/0 un|R\$ 0/.test(v)));
});
test('cartões do período anterior nunca valem para o novo pedido (carregando, erro ou período inválido)',()=>{
  const k1=requestKey('SHOPEE','2026-10-01','2026-10-31',false), k2=requestKey('SHOPEE','2026-11-01','2026-11-24',false);
  const result={key:k1,data:{platform:'SHOPEE'}};
  assert.equal(isCurrentResult(result,k1),true);
  assert.equal(isCurrentResult(result,k2),false,'novo período: resultado antigo não vale');
  assert.equal(isCurrentResult(result,requestKey('ML_NOVO','2026-10-01','2026-10-31',false)),false);
  assert.equal(isCurrentResult(result,requestKey('SHOPEE','2026-10-01','2026-10-31',true)),false);
  assert.equal(isCurrentResult(null,k1),false);
  assert.ok(/setResult\(null\)/.test(ui)&&ui.includes('isCurrentResult(result,key)')&&ui.includes('!loading&&!error'),'tela só mostra cartões do pedido atual');
  assert.ok(ui.includes('meses inteiros'));
});
test('modo privacidade do GA mascara os valores em R$ da nova tela',()=>{
  const data=base({ml_unlinked_sales:{severity:'INFORMATIVO',listings_with_sales:2,listings_without_registered_listing:1,units_without_registered_listing:3,revenue_without_registered_listing:123.45,total_units:10,total_revenue:999,pct_revenue:12,pct_units:30,items:[{external_listing_id:'L1',units:3,revenue:123.45}],note:'n'}});
  setPrivate(false);
  const open=JSON.stringify(buildCards(data));
  assert.ok(/R\$\s?123,45/.test(open));
  setPrivate(true);
  try{
    const hidden=JSON.stringify(buildCards(data));
    assert.ok(!/123,45|999,00/.test(hidden)&&hidden.includes(MONEY_MASK));
  }finally{setPrivate(false);}
  assert.ok(ui.includes("usePrivacy()"));
});
test('catálogo: quantidade e percentual de anúncios desatualizados; não afirma que todos são ativos',()=>{
  const c=catalogCard({catalog:{freshness:'PARCIALMENTE_DESATUALIZADO',listings:4,fresh_listings:1,stale_listings:2,never_checked_listings:1,not_fresh_listings:3,not_fresh_pct:75,days_since_oldest_check:20,last_checked_at:'2026-11-24T10:00:00Z',oldest_checked_at:'2026-11-04T10:00:00Z',note:'x'}});
  assert.equal(c.dims[0].value,'Parcialmente desatualizado');
  assert.ok(c.actions.some(a=>a.includes('3 de 4')&&a.includes('75%')&&a.includes('20 dias')));
  assert.ok(c.lines.some(([k,v])=>k.startsWith('Desatualizados')&&v==='2'));
  assert.ok(!JSON.stringify(c).includes('só anúncios ativos'));
  const none=catalogCard({catalog:{freshness:'SEM_INFORMACAO',listings:3,never_checked_listings:3,not_fresh_listings:3}});
  assert.ok(none.actions[0].includes('não dá para dizer'));
});
test('lotes antigos: pedir análise antes; nunca incentivar aplicar',()=>{
  const c=batchesCard({open_batches:[{batch_id:10,file:'a.xlsx',status:'STAGED',rows:5,data_through:'2026-10-01'}]});
  assert.ok(c.actions[0].includes('Analise')&&c.actions[0].includes('Não aplique relatório antigo nem parte pendente'));
  assert.ok(!/^Aplique/.test(c.actions[0]));
  assert.deepEqual(batchesCard({open_batches:[]}).actions,[]);
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
test('preço e estoque: sem valor válido, parcial e foto disponível; estoque nominal nunca é real',()=>{
  const mk=(rs,ss,extra={})=>priceStockCard({price_stock:{registered_price:{status:rs,variations:10,variations_with_price:rs==='SEM_VALOR_VALIDO'?0:7,variations_without_valid_price:3},
    realized_price:{status:'DISPONIVEL',listings_with_units:3},stock:{status:ss,variations:10,variations_with_stock:ss==='SEM_VALOR_VALIDO'?0:10,variations_without_valid_stock:0,...extra}}});
  const none=mk('SEM_VALOR_VALIDO','SEM_VALOR_VALIDO');
  assert.equal(none.dims[0].value,'Sem valor válido'); assert.ok(none.actions.some(a=>a.includes('nenhuma tem preço válido')));
  const part=mk('PARCIAL','DISPONIVEL_FOTO');
  assert.equal(part.dims[0].value,'Cobertura parcial'); assert.ok(part.actions.some(a=>a.includes('3 variação')));
  const ok=mk('DISPONIVEL_FOTO','DISPONIVEL_FOTO');
  assert.ok(ok.dims[0].value.startsWith('Foto disponível'));
  assert.deepEqual(ok.dims.map(d=>d.label),['Preço cadastrado','Preço realizado','Estoque (valor declarado)']);
  const nom=mk('DISPONIVEL_FOTO','DISPONIVEL_FOTO',{possibly_nominal:true,most_common_value:'4999',most_common_share_pct:90});
  assert.ok(nom.actions.some(a=>a.includes('4999')&&a.includes('Não use como estoque real')));
  assert.equal(nom.dims[2].tone,'warn');
  assert.ok(!/estoque real\b(?!\.)/.test(nom.dims[2].value));
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
