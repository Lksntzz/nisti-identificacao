// GA-013 — correções da revisão técnica da PR #920. Dados 100% fictícios.
import test from 'node:test';
import assert from 'node:assert/strict';
import {strategicPeriods,buildStrategicView,FORBIDDEN_KEY_RE} from '../src/ga/commerce-strategic-logic.js';

const dash=(o={})=>({platform:'SHOPEE',days:7,first_day:'2025-01-01',last_day:'2026-11-23',current_start:'2026-11-17',previous_start:'2026-11-10',
  totals:{cur_units:135,prev_units:100,cur_rev:9,prev_rev:8},drops:{total:57,items:[{listing_id:2,platform:'SHOPEE',external_id:'B2',title:'B',units:2,units_previous:10,lost_revenue:40}]},...o});
const dq=(platform,start,end,days,ok=true)=>({platform,period:{start,end},sales:{status:ok?'COMPLETA':'PARCIAL',requested_days:days,complete_days:ok?days:days-2,
  partial_days:0,days_without_information:ok?0:2,days_with_records_unverified:0,missing_ranges:ok?[]:[{start,end:start,days:2}]}});
const base=(o={})=>({platform:'SHOPEE',days:7,dash:dash(),periods:strategicPeriods(dash()),
  overview:{listings:{active:3},top_units:[{listing_id:1,platform:'SHOPEE',external_id:'A1',title:'A',units:80,units_previous:50}],
    growth:[{listing_id:1,platform:'SHOPEE',external_id:'A1',title:'A',units:80,units_previous:50}],
    stopped:[{listing_id:3,platform:'SHOPEE',external_id:'C3',title:'C',units_ever:30,last_sale:'2026-10-01',days_since:53}],stopped_total:400,
    no_sales:[{listing_id:4,platform:'SHOPEE',external_id:'D4',title:'D',units_ever:0,last_sale:null}],no_sales_never:9,unlinked:{listings:1}},
  monthly:{months:[]},series:{daily:[]},
  categories:{platform:'SHOPEE',cur_from:'2026-11-17',cur_to:'2026-11-23',base_from:'2025-11-17',base_to:'2025-11-23',total:{cur:140,base:90},
    categories:[{name:'Cat',cur:140,base:90,cols:[]}]},
  split:{status:'COMPLETO',total_units:140,linked_units:135,unlinked_units:5,base_units:135,difference:{units:-5,other_explained_units:0,residual_units:0},
    reconciliation:{status:'EXPLICADA'},coverage:{missing_days:0}},
  dqCurrent:dq('SHOPEE','2026-11-17','2026-11-23',7),dqPrevious:dq('SHOPEE','2026-11-10','2026-11-16',7),dqHistory:dq('SHOPEE','2025-01-01','2026-11-23',692,false),
  dqCatBase:dq('SHOPEE','2025-11-17','2025-11-23',7),perf:{shopee:{reports:[],items:{}},ml:{reports:[],items:{}}},failed:[],...o});

test('4: sem cobertura, títulos e contagens viram "possíveis" e nunca "confirmados"',()=>{
  const v=buildStrategicView(base({dqPrevious:dq('SHOPEE','2026-11-10','2026-11-16',7,false)}));
  for(const g of [v.movements.growth,v.movements.drops]){
    assert.equal(g.kind,'CANDIDATO'); assert.match(g.title,/possíve|não confirmad/i); assert.doesNotMatch(g.title,/^(Crescimento|Queda)$/);
  }
  assert.match(v.movements.drops.count_label,/57 possíveis quedas \(não confirmadas\)/);
  assert.equal(v.movements.stopped.kind,'CONFIRMADO'); // período atual comprovado
});
test('4: período atual não comprovado → parados também são candidatos',()=>{
  const v=buildStrategicView(base({dqCurrent:dq('SHOPEE','2026-11-17','2026-11-23',7,false)}));
  assert.equal(v.movements.stopped.kind,'CANDIDATO'); assert.match(v.movements.stopped.count_label,/400 possíveis/);
});
test('4: com cobertura comprovada os títulos são os confirmados',()=>{
  const v=buildStrategicView(base());
  assert.equal(v.movements.growth.kind,'CONFIRMADO'); assert.equal(v.movements.drops.title,'Queda'); assert.match(v.movements.drops.count_label,/57 anúncios em queda/);
});
test('4: "nunca vendeu" nunca vale para toda a existência do anúncio, nem com histórico comprovado',()=>{
  const v=buildStrategicView(base({dqHistory:dq('SHOPEE','2025-01-01','2026-11-23',692)}));
  const n=v.movements.never;
  assert.equal(n.items[0].label,'SEM_VENDA_HISTORICO_IMPORTADO'); assert.equal(n.verified,true);
  assert.match(n.title,/histórico importado/i); assert.doesNotMatch(n.title,/nunca vendeu/i);
  assert.deepEqual(n.history_span,{start:'2025-01-01',end:'2026-11-23'});
  assert.match(n.note,/antes de 2025-01-01|não prova/i);
  const nv=buildStrategicView(base()).movements.never;
  assert.equal(nv.items[0].label,'SEM_VENDAS_HISTORICO_NAO_VERIFICADO'); assert.equal(nv.kind,'CANDIDATO');
});
test('5: ranking de queda declara que é por faturamento perdido, com total e limite',()=>{
  const d=buildStrategicView(base()).movements.drops;
  assert.equal(d.ordering,'VALOR_PERDIDO'); assert.equal(d.limit,20); assert.equal(d.total,57); assert.equal(d.shown,1); assert.equal(d.truncated,true);
  assert.match(d.ordering_note,/valor de venda perdido/i); assert.match(d.ordering_note,/não é.*unidades/i);
  assert.equal(d.ordering_note.match(/R\$/),null);
  walkNoForbiddenKeys(d);
});
test('6: consulta indisponível não vira lista vazia; lista cheia é truncada',()=>{
  const v=buildStrategicView(base({overview:null,failed:['overview']}));
  for(const k of ['growth','stopped','never'])assert.equal(v.movements[k].available,false,k);
  assert.equal(v.champions_available,false);
  const ok=buildStrategicView(base({overview:{...base().overview,growth:[]}}));
  assert.equal(ok.movements.growth.available,true); assert.equal(ok.movements.growth.items.length,0);
  const big=Array.from({length:10},(_, i)=>({listing_id:i,platform:'SHOPEE',external_id:'G'+i,title:'g',units:20,units_previous:10}));
  const g=buildStrategicView(base({overview:{...base().overview,growth:big}})).movements.growth;
  assert.equal(g.limit,10); assert.equal(g.truncated,true); assert.match(g.limit_note,/pode haver mais/i);
  const s=buildStrategicView(base()).movements.stopped;
  assert.equal(s.truncated,true); assert.equal(s.limit,300); assert.equal(s.total,400);
});
test('7: unidades declaram a base; SKU total e vinculadas nunca se misturam',()=>{
  const v=buildStrategicView(base());
  assert.equal(v.units.basis,'ANUNCIOS_VINCULADOS'); assert.equal(v.units.current,135);
  assert.equal(v.units.sku_total.current,140); assert.equal(v.units.sku_total.basis,'TOTAL_POR_SKU');
  assert.equal(v.categories.basis,'TOTAL_POR_SKU');
  const ml=buildStrategicView(base({platform:'ML_NOVO',dash:dash({platform:'ML_NOVO'}),split:null,categories:{...base().categories,platform:'ML_NOVO'},
    dqCurrent:dq('ML_NOVO','2026-11-17','2026-11-23',7)}));
  assert.equal(ml.units.basis,'POR_ANUNCIO'); assert.equal(ml.categories.basis,'POR_ANUNCIO'); assert.equal(ml.units.sku_total,null);
});
test('7: se o total do Dashboard não bate com a base da divisão, avisa',()=>{
  const v=buildStrategicView(base({split:{...base().split,base_units:120}}));
  assert.ok(v.notices.some(n=>n.kind==='BASE_UNIDADES_DIVERGENTE'));
});
test('2: categorias informam as datas reais, comparação anual e dia/período diferente',()=>{
  const v=buildStrategicView(base());
  assert.deepEqual(v.categories.period.current,{start:'2026-11-17',end:'2026-11-23'});
  assert.deepEqual(v.categories.period.base,{start:'2025-11-17',end:'2025-11-23'});
  assert.equal(v.categories.comparison,'ANO_ANTERIOR'); assert.equal(v.categories.aligned,true);
  assert.deepEqual(v.categories.verified,{current:true,base:true});
  assert.ok(v.notices.some(n=>n.kind==='CATEGORIAS_COMPARACAO_ANUAL'));
  const off=buildStrategicView(base({categories:{...base().categories,cur_to:'2026-11-24',cur_from:'2026-11-18',base_from:'2025-11-18',base_to:'2025-11-24'},
    dqCatCurrent:dq('SHOPEE','2026-11-18','2026-11-24',7,false),dqCatBase:dq('SHOPEE','2025-11-18','2025-11-24',7)}));
  assert.equal(off.categories.aligned,false); assert.deepEqual(off.categories.verified,{current:false,base:true});
  const kinds=off.notices.map(n=>n.kind);
  assert.ok(kinds.includes('CATEGORIAS_PERIODO_DIFERENTE')&&kinds.includes('CATEGORIAS_NAO_VERIFICADAS'));
});
test('3: respostas de outra conta ou de outro período são rejeitadas',()=>{
  const v=buildStrategicView(base({dash:dash({platform:'ML_NOVO'})}));
  assert.equal(v.status,'SEM_INFORMACAO'); assert.equal(v.parts.dashboard,'RESPOSTA_INVALIDA'); assert.equal(v.units.current,null);
  const d=buildStrategicView(base({dash:dash({days:30})}));
  assert.equal(d.parts.dashboard,'RESPOSTA_INVALIDA');
  const c=buildStrategicView(base({categories:{...base().categories,platform:'ML_ANTIGO'}}));
  assert.equal(c.categories,null); assert.equal(c.parts.categories,'RESPOSTA_INVALIDA');
  const o=buildStrategicView(base({overview:{...base().overview,platform:'ML_NOVO'}}));
  assert.equal(o.parts.overview,'RESPOSTA_INVALIDA'); assert.equal(o.movements.growth.available,false);
});
test('8: a visão declara o que vem de cache do banco e o que é ao vivo',()=>{
  const v=buildStrategicView(base());
  assert.deepEqual(v.sources.cached_in_database.sort(),['categories','dashboard','monthly','overview','series']);
  assert.deepEqual(v.sources.live.sort(),['performance','quality','split']);
  assert.match(v.sources.note,/6 horas|nova importação/i);
});
function walkNoForbiddenKeys(o){if(Array.isArray(o))o.forEach(walkNoForbiddenKeys);else if(o&&typeof o==='object')for(const[k,x]of Object.entries(o)){assert.equal(FORBIDDEN_KEY_RE.test(k),false,k);walkNoForbiddenKeys(x);}}
