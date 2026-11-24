// GA-013 — contratos reais das respostas e cobertura não comprovada nos cartões. Dados 100% fictícios.
import test from 'node:test';
import assert from 'node:assert/strict';
import {strategicPeriods,buildStrategicView} from '../src/ga/commerce-strategic-logic.js';

const dash=(o={})=>({platform:'SHOPEE',days:7,first_day:'2025-01-01',last_day:'2026-11-23',current_start:'2026-11-17',previous_start:'2026-11-10',
  totals:{cur_units:135,prev_units:100},drops:{total:3,items:[]},...o});
const dq=(platform,start,end,ok=true,extra={})=>{const span=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
  return {platform,period:{start,end},sales:{status:ok?'COMPLETA':'PARCIAL',requested_days:span,complete_days:ok?span:span-2,partial_days:0,
    days_without_information:ok?0:2,days_with_records_unverified:0,missing_ranges:ok?[]:[{start:end,end,days:2}],...extra}};};
// Formato REAL do resumo: sem platform/days no topo; conta e datas só em coverage.
const overview=(o={})=>({listings:{active:30,inactive:4,active_without_sales:5},orders:{current:1,previous:1},
  top_units:[{listing_id:1,platform:'SHOPEE',external_id:'A1',title:'A',units:80,units_previous:50}],growth:[],stopped:[],stopped_total:0,no_sales:[],no_sales_never:0,
  unlinked:{listings:1},ads:{rows:[]},window_days_with_sales:7,
  coverage:[{platform:'SHOPEE',first_day:'2025-01-01',last_day:'2026-11-23',last_import:'2026-11-24T13:53:39+00:00'}],...o});
const day=i=>new Date(Date.parse('2026-11-17')+i*86400000).toISOString().slice(0,10);
const series=(o={})=>({platform:'SHOPEE',month:null,days:7,daily:Array.from({length:7},(_,i)=>({day:day(i),units_shopee:i+1,prev_units_shopee:i})),...o});
const monthly=(o={})=>({platform:'SHOPEE',first_day:'2025-01-01',last_day:'2026-11-23',months:[{month:'2026-10',units_shopee:120,days_with_sales:31,first_day:'2026-10-01',last_day:'2026-10-31'},
  {month:'2026-11',units_shopee:90,days_with_sales:23,first_day:'2026-11-01',last_day:'2026-11-23'}],...o});
const split=(o={})=>({start:'2026-11-17',end:'2026-11-23',status:'COMPLETO',total_units:140,linked_units:135,unlinked_units:5,base_units:135,
  difference:{units:-5,other_explained_units:0,residual_units:0},reconciliation:{status:'EXPLICADA'},coverage:{missing_days:0},...o});
const cats=(o={})=>({platform:'SHOPEE',cur_from:'2026-11-17',cur_to:'2026-11-23',base_from:'2025-11-17',base_to:'2025-11-23',total:{cur:1,base:1},categories:[],...o});
const mk=(o={})=>({platform:'SHOPEE',days:7,dash:dash(),periods:strategicPeriods(dash()),overview:overview(),monthly:monthly(),series:series(),categories:cats(),split:split(),
  dqCurrent:dq('SHOPEE','2026-11-17','2026-11-23'),dqPrevious:dq('SHOPEE','2026-11-10','2026-11-16'),dqHistory:dq('SHOPEE','2025-01-01','2026-11-23',false),
  dqCatBase:dq('SHOPEE','2025-11-17','2025-11-23'),perf:{shopee:{reports:[],items:{}},ml:{reports:[],items:{}}},failed:[],...o});

test('contrato real do resumo: conta e datas conferidas pela cobertura retornada',()=>{
  const v=buildStrategicView(mk());
  assert.equal(v.parts.overview,'OK'); assert.equal(v.validation.levels.overview,'CONFIRMADA');
  const other=buildStrategicView(mk({overview:overview({coverage:[{platform:'ML_NOVO',first_day:'2025-01-01',last_day:'2026-11-23'}]})}));
  assert.equal(other.parts.overview,'RESPOSTA_INVALIDA'); assert.equal(other.movements.growth.available,false); assert.equal(other.champions_available,false);
  const dates=buildStrategicView(mk({overview:overview({coverage:[{platform:'SHOPEE',first_day:'2025-01-01',last_day:'2026-11-20'}]})}));
  assert.equal(dates.parts.overview,'RESPOSTA_INVALIDA');
  const win=buildStrategicView(mk({overview:overview({window_days_with_sales:30})}));
  assert.equal(win.parts.overview,'RESPOSTA_INVALIDA','mais dias com venda do que o período pedido: janela errada');
});
test('resumo sem cobertura retornada: aceito, mas a limitação é declarada',()=>{
  const v=buildStrategicView(mk({overview:overview({coverage:[]})}));
  assert.equal(v.parts.overview,'OK'); assert.equal(v.validation.levels.overview,'NAO_CONFIRMAVEL');
  assert.ok(v.validation.limitations.some(t=>/Resumo/.test(t)&&/conferência independente/.test(t)));
});
test('divisão por SKU: datas devem ser as do período atual',()=>{
  assert.equal(buildStrategicView(mk()).validation.levels.split,'CONFIRMADA');
  const bad=buildStrategicView(mk({split:split({start:'2026-11-10',end:'2026-11-16'})}));
  assert.equal(bad.parts.split,'RESPOSTA_INVALIDA'); assert.equal(bad.sales_split.status,'RESPOSTA_INVALIDA'); assert.equal(bad.units.sku_total,null);
  const noDates=buildStrategicView(mk({split:split({start:undefined,end:undefined})}));
  assert.equal(noDates.validation.levels.split,'NAO_CONFIRMAVEL');
});
test('série diária: conta, quantidade e datas conferidas contra o período atual',()=>{
  assert.equal(buildStrategicView(mk()).validation.levels.series,'CONFIRMADA');
  for(const bad of [series({platform:'ML_NOVO'}),series({days:30}),series({daily:series().daily.slice(1)}),
    series({daily:series().daily.map((d,i)=>({...d,day:day(i+1)}))})]){
    const v=buildStrategicView(mk({series:bad}));
    assert.equal(v.parts.series,'RESPOSTA_INVALIDA'); assert.deepEqual(v.evolution.daily,[]);
  }
});
test('série mensal e categorias: datas incompatíveis são rejeitadas',()=>{
  assert.equal(buildStrategicView(mk({monthly:monthly({last_day:'2026-11-01'})})).parts.monthly,'RESPOSTA_INVALIDA');
  assert.equal(buildStrategicView(mk()).validation.levels.monthly,'CONFIRMADA');
  assert.equal(buildStrategicView(mk({categories:cats({cur_from:'2026-11-01'})})).parts.categories,'RESPOSTA_INVALIDA');
});
test('cartão de anúncios sem venda: cobertura não comprovada não vira certeza de ausência',()=>{
  const ok=buildStrategicView(mk()).listings;
  assert.equal(ok.coverage_verified,true); assert.equal(ok.active_without_sales_label,'sem venda no período');
  const un=buildStrategicView(mk({dqCurrent:dq('SHOPEE','2026-11-17','2026-11-23',false)})).listings;
  assert.equal(un.coverage_verified,false);
  assert.match(un.active_without_sales_label,/sem venda nos dados importados \(cobertura não comprovada\)/);
  assert.equal(un.active_without_sales,5,'o número continua visível');
});
test('campeões: ranking marcado como não verificado quando o período atual não está comprovado',()=>{
  const ok=buildStrategicView(mk());
  assert.equal(ok.champions_verified,true); assert.equal(ok.champions_note,null);
  const un=buildStrategicView(mk({dqCurrent:dq('SHOPEE','2026-11-17','2026-11-23',false)}));
  assert.equal(un.champions_verified,false); assert.match(un.champions_note,/cobertura do período atual não comprovada/);
  assert.equal(un.champions.length,1);
});
test('evolução histórica: mês com lacuna, mês sem verificação e dia sem informação',()=>{
  const gap=dq('SHOPEE','2025-01-01','2026-11-23',false,{missing_ranges:[{start:'2026-10-05',end:'2026-10-07',days:3}],days_without_information:3});
  const v=buildStrategicView(mk({dqHistory:gap,dqCurrent:dq('SHOPEE','2026-11-17','2026-11-23',false,{missing_ranges:[{start:'2026-11-20',end:'2026-11-21',days:2}]})}));
  const m=Object.fromEntries(v.evolution.months.map(x=>[x.month,x.coverage]));
  assert.equal(m['2026-10'],'COM_LACUNA'); assert.equal(m['2026-11'],'COMPROVADA');
  const d=Object.fromEntries(v.evolution.daily.map(x=>[x.day,x.state]));
  assert.equal(d['2026-11-20'],'SEM_INFORMACAO'); assert.equal(d['2026-11-17'],'NAO_VERIFICADO');
  const partial=buildStrategicView(mk({dqHistory:dq('SHOPEE','2025-01-01','2026-11-23',false,{partial_days:4,missing_ranges:[]})}));
  assert.ok(partial.evolution.months.every(x=>x.coverage==='NAO_VERIFICADA'));
  assert.equal(partial.evolution.verified.months,false);
  const proven=buildStrategicView(mk({dqHistory:dq('SHOPEE','2025-01-01','2026-11-23')}));
  assert.ok(proven.evolution.months.every(x=>x.coverage==='COMPROVADA')); assert.ok(proven.evolution.daily.every(x=>x.state==='OK'));
});

test('GA-013A: anúncios com vendas vem de totals.listings do Dashboard (contrato real), inclui inativos',()=>{
  const v=buildStrategicView(mk({dash:dash({totals:{cur_units:135,prev_units:100,listings:92}})}));
  assert.equal(v.listings.with_sales,92);
  assert.equal(v.listings.with_sales_includes_inactive,true);
  assert.match(v.listings.with_sales_note,/inclui anúncios inativos/);
  // o nome antigo/inexistente não é usado
  const old=buildStrategicView(mk({dash:dash({totals:{cur_units:135,prev_units:100,listings_selling:25}})}));
  assert.equal(old.listings.with_sales,null);
  assert.equal(buildStrategicView(mk({dash:null,periods:null})).listings.with_sales,null);
});

const rng=(start,end)=>({start,end,days:Math.round((Date.parse(end)-Date.parse(start))/864e5)+1});
test('GA-013A: dia sem informação é lacuna (null), nunca zero; cobertura do período anterior é separada',()=>{
  const cur=dq('SHOPEE','2026-11-17','2026-11-23',false,{missing_ranges:[rng('2026-11-20','2026-11-21')],days_without_information:2});
  const prev=dq('SHOPEE','2026-11-10','2026-11-16',false,{missing_ranges:[rng('2026-11-12','2026-11-12')],days_without_information:1});
  const sr=series({daily:series().daily.map((d,i)=>({...d,units_shopee:i===3||i===4?0:5,prev_units_shopee:i===2?0:4}))});
  const v=buildStrategicView(mk({series:sr,dqCurrent:cur,dqPrevious:prev}));
  const d=v.evolution.daily;
  assert.equal(d[3].units,null); assert.equal(d[3].state,'SEM_INFORMACAO'); assert.equal(d[4].units,null);
  assert.equal(d[0].units,5); assert.equal(d[0].state,'NAO_VERIFICADO');
  assert.equal(d[2].units_previous,null); assert.equal(d[2].previous_state,'SEM_INFORMACAO');
  assert.equal(d[0].units_previous,4); assert.equal(d[0].previous_state,'NAO_VERIFICADO');
  assert.deepEqual(v.evolution.verified,{months:false,daily:false,daily_previous:false});
});
test('GA-013A: zero real em dia comprovado continua zero',()=>{
  const sr=series({daily:series().daily.map((d,i)=>({...d,units_shopee:i===0?0:3,prev_units_shopee:i===0?0:3}))});
  const v=buildStrategicView(mk({series:sr}));
  assert.equal(v.evolution.daily[0].units,0); assert.equal(v.evolution.daily[0].units_previous,0);
  assert.equal(v.evolution.daily[0].state,'OK'); assert.equal(v.evolution.daily[0].previous_state,'OK');
});
test('GA-013A: mês anterior é o mês de calendário imediatamente anterior, e meses incompletos são identificados',()=>{
  const m=(month,u)=>({month,units_shopee:u,days_with_sales:20,first_day:month+'-01',last_day:month+'-28'});
  const mo=monthly({months:[m('2026-08',50),m('2026-10',120),m('2026-11',90)]});
  const v=buildStrategicView(mk({monthly:mo}));
  const by=Object.fromEntries(v.evolution.months.map(x=>[x.month,x]));
  assert.equal(by['2026-10'].previous.month,'2026-09'); assert.equal(by['2026-10'].previous.units,null,'setembro ausente da série: nunca vira zero');
  assert.equal(by['2026-10'].previous.absent,true);
  assert.equal(by['2026-11'].previous.month,'2026-10'); assert.equal(by['2026-11'].previous.units,120);
  assert.equal(by['2026-11'].incomplete,true); assert.equal(by['2026-11'].incomplete_until,'2026-11-23');
  assert.equal(by['2026-10'].incomplete,false);
  assert.equal(by['2026-08'].previous.month,'2026-07');
  const part=buildStrategicView(mk({dash:dash({first_day:'2026-08-10'}),periods:strategicPeriods(dash({first_day:'2026-08-10'})),monthly:monthly({first_day:'2026-08-10',months:[m('2026-08',50),m('2026-09',60)]})}));
  const p=Object.fromEntries(part.evolution.months.map(x=>[x.month,x]));
  assert.equal(p['2026-08'].incomplete,true); assert.equal(p['2026-08'].incomplete_from,'2026-08-10');
});
