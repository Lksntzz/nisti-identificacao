// GA-013 — Visão estratégica: regras puras. Dados 100% fictícios.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STRATEGIC_PLATFORMS, STRATEGIC_DAYS, isStrategicPlatform, strategicPeriods, coverageState, classifyChange,
  movementLabel, trafficFor, salesSplit, stripCommercial, FORBIDDEN_KEY_RE, buildStrategicView
} from '../src/ga/commerce-strategic-logic.js';

const dash=(over={})=>({platform:'SHOPEE',days:7,first_day:'2025-01-01',last_day:'2026-11-23',current_start:'2026-11-17',
  previous_start:'2026-11-10',previous_complete:true,totals:{cur_units:140,prev_units:100,cur_rev:999,prev_rev:888,listings:3},
  drops:{items:[],total:0,lost_revenue:5},...over});
const complete=(platform,start,end,days)=>({platform,period:{start,end},sales:{status:'COMPLETA',requested_days:days,complete_days:days,
  partial_days:0,days_without_information:0,days_with_records_unverified:0,missing_ranges:[]}});
const partial=(platform,start,end,days)=>({platform,period:{start,end},sales:{status:'PARCIAL',requested_days:days,complete_days:days-3,
  partial_days:0,days_without_information:3,days_with_records_unverified:0,missing_ranges:[{start,end:start,days:3}]}});
const P=(over={})=>strategicPeriods(dash(over));

test('plataformas: só as três contas, sem Consolidado; janelas 7/30/60/90',()=>{
  assert.deepEqual(STRATEGIC_PLATFORMS.map(p=>p.id),['SHOPEE','ML_ANTIGO','ML_NOVO']);
  assert.deepEqual([...STRATEGIC_DAYS],[7,30,60,90]);
  assert.equal(isStrategicPlatform('TODAS'),false);
  assert.equal(isStrategicPlatform('ML_NOVO'),true);
  assert.equal(isStrategicPlatform('shopee'),false);
});

test('períodos vêm do Dashboard: atual até o último dia importado, anterior logo antes',()=>{
  const p=P();
  assert.deepEqual(p.current,{start:'2026-11-17',end:'2026-11-23'});
  assert.deepEqual(p.previous,{start:'2026-11-10',end:'2026-11-16'});
  assert.deepEqual(p.history,{start:'2025-01-01',end:'2026-11-23'});
  assert.equal(strategicPeriods(null),null);
  assert.equal(strategicPeriods({platform:'SHOPEE'}),null);
});

test('cobertura: comprovada só com GA-018 da MESMA conta e do MESMO período, completa',()=>{
  const p=P();
  const ok=coverageState({platform:'SHOPEE',periods:p,dqCurrent:complete('SHOPEE','2026-11-17','2026-11-23',7),
    dqPrevious:complete('SHOPEE','2026-11-10','2026-11-16',7),dqHistory:partial('SHOPEE','2025-01-01','2026-11-23',692)});
  assert.equal(ok.current.proven,true); assert.equal(ok.previous.proven,true); assert.equal(ok.history.proven,false);
  // conta errada nunca comprova
  const other=coverageState({platform:'SHOPEE',periods:p,dqCurrent:complete('ML_NOVO','2026-11-17','2026-11-23',7),
    dqPrevious:null,dqHistory:null});
  assert.equal(other.current.proven,false);
  // período diferente nunca comprova
  const diff=coverageState({platform:'SHOPEE',periods:p,dqCurrent:complete('SHOPEE','2026-11-16','2026-11-23',8),dqPrevious:null,dqHistory:null});
  assert.equal(diff.current.proven,false);
  // ausência da consulta ≠ cobertura parcial
  assert.equal(other.previous.reason,'INDISPONIVEL');
  assert.equal(ok.history.reason,'NAO_COMPROVADA');
  const none=coverageState({platform:'SHOPEE',periods:p,dqCurrent:{platform:'SHOPEE',period:{start:'2026-11-17',end:'2026-11-23'},sales:{status:'SEM_INFORMACAO'}},dqPrevious:null,dqHistory:null});
  assert.equal(none.current.reason,'SEM_INFORMACAO');
});

test('limiares de variação iguais aos do Dashboard (5/10 unidades e 15%)',()=>{
  assert.equal(classifyChange(20,10),'CRESCIMENTO');
  assert.equal(classifyChange(10,5),'CRESCIMENTO');
  assert.equal(classifyChange(9,5),'ESTAVEL');       // atual < 10: não é crescimento
  assert.equal(classifyChange(11,10),'ESTAVEL');     // +10%
  assert.equal(classifyChange(8,10),'QUEDA');        // -20%
  assert.equal(classifyChange(0,6),'QUEDA');
  assert.equal(classifyChange(5,5),'ESTAVEL');
  assert.equal(classifyChange(3,4),'POUCO_VOLUME');  // anterior < 5: não classifica
  assert.equal(classifyChange(null,10),'POUCO_VOLUME');
});

test('rótulos: crescimento e queda exigem os DOIS períodos comprovados',()=>{
  const full={current:{proven:true},previous:{proven:true},history:{proven:false,reason:'NAO_COMPROVADA'}};
  assert.equal(movementLabel('growth',{units:20,units_previous:10},full).label,'CRESCIMENTO');
  assert.equal(movementLabel('drop',{units:2,units_previous:10},full).label,'QUEDA');
  const noPrev={current:{proven:true},previous:{proven:false,reason:'NAO_COMPROVADA'},history:{proven:false}};
  const r=movementLabel('growth',{units:20,units_previous:10},noPrev);
  assert.equal(r.label,'SEM_CLASSIFICACAO'); assert.equal(r.reason,'PERIODO_ANTERIOR_NAO_COMPROVADO');
  const noCur={current:{proven:false,reason:'NAO_COMPROVADA'},previous:{proven:true},history:{proven:false}};
  assert.equal(movementLabel('drop',{units:2,units_previous:10},noCur).reason,'PERIODO_ATUAL_NAO_COMPROVADO');
});

test('parou: só o período atual precisa estar comprovado; última venda antiga é avisada como não verificada',()=>{
  const cur={current:{proven:true},previous:{proven:false},history:{proven:false}};
  const r=movementLabel('stopped',{units_ever:12,last_sale:'2026-09-02',days_since:82},cur);
  assert.equal(r.label,'PAROU'); assert.equal(r.last_sale_verified,false);
  const none={current:{proven:false,reason:'NAO_COMPROVADA'},previous:{proven:false},history:{proven:false}};
  assert.equal(movementLabel('stopped',{units_ever:12,last_sale:'2026-09-02'},none).label,'SEM_CLASSIFICACAO');
});

test('nunca vendeu: só com TODO o histórico importado comprovado; senão "sem vendas no histórico importado"',()=>{
  const row={units_ever:0,last_sale:null};
  const hist={current:{proven:true},previous:{proven:true},history:{proven:true}};
  assert.equal(movementLabel('no_sales',row,hist).label,'SEM_VENDA_HISTORICO_IMPORTADO');
  const noHist={current:{proven:true},previous:{proven:true},history:{proven:false,reason:'NAO_COMPROVADA'}};
  const r=movementLabel('no_sales',row,noHist);
  assert.equal(r.label,'SEM_VENDAS_HISTORICO_NAO_VERIFICADO');
  // vendeu alguma vez, mas sem venda no período: precisa do período atual comprovado
  const had={units_ever:2,last_sale:'2026-10-20'};
  assert.equal(movementLabel('no_sales',had,noHist).label,'SEM_VENDA_NO_PERIODO');
  const none={current:{proven:false,reason:'NAO_COMPROVADA'},previous:{proven:false},history:{proven:false}};
  assert.equal(movementLabel('no_sales',had,none).label,'SEM_CLASSIFICACAO');
});

test('visitas/impressões/conversão: só do relatório da MESMA conta; ausência nunca vira zero',()=>{
  const perf={
    shopee:{reports:[{start:'2026-11-01',end:'2026-11-14'}],items:{A1:{visits:900,impressions:12000,conversion_pct:1.1,units:4,gross:77}}},
    ml:{reports:[{account:'NOVO',start:'2026-11-01',end:'2026-11-14'}],items:{A1:{account:'NOVO',visits:50,conversion_pct:2,gross:5,sales:3}}}
  };
  const sp=trafficFor('SHOPEE',{external_id:'A1'},perf);
  assert.deepEqual(sp,{visits:900,impressions:12000,conversion_pct:1.1,period:{start:'2026-11-01',end:'2026-11-14'}});
  // mesmo ID no ML Novo: usa o item do ML Novo, sem impressões (campo ausente = null)
  const mn=trafficFor('ML_NOVO',{external_id:'A1'},perf);
  assert.equal(mn.visits,50); assert.equal(mn.impressions,null);
  // ML Antigo não tem relatório: nada, nunca herda o do Novo
  assert.equal(trafficFor('ML_ANTIGO',{external_id:'A1'},perf),null);
  assert.equal(trafficFor('SHOPEE',{external_id:'ZZ'},perf),null);
  // nenhum campo comercial vaza
  assert.ok(!Object.keys(mn).concat(Object.keys(sp)).some(k=>FORBIDDEN_KEY_RE.test(k)));
});

test('Shopee: total, vinculada, sem vínculo e resíduo ficam separados; resíduo nunca vira sem vínculo',()=>{
  const split={status:'COMPLETO',total_units:1000,linked_units:950,unlinked_units:30,unlinked_sku_count:4,base_units:950,
    difference:{units:-50,unlinked_effect_units:-30,other_explained_units:-10,residual_units:-10,explained:false},
    reconciliation:{status:'RESIDUO_NAO_EXPLICADO',source_units_match:true,identity_ok:true},coverage:{missing_days:0,days_with_data:7,missing_ranges:[]}};
  const s=salesSplit('SHOPEE',{split});
  assert.equal(s.kind,'SHOPEE'); assert.equal(s.total,1000); assert.equal(s.linked,950); assert.equal(s.unlinked,30);
  assert.equal(s.other_explained,-10); assert.equal(s.residual,-10); assert.equal(s.status,'RESIDUO_NAO_EXPLICADO');
  assert.notEqual(s.unlinked,s.unlinked+s.residual);
  const bad=salesSplit('SHOPEE',{split:{...split,reconciliation:{status:'INCONSISTENTE'}}});
  assert.equal(bad.status,'INCONSISTENTE');
  const empty=salesSplit('SHOPEE',{split:{status:'SEM_INFORMACAO',total_units:null}});
  assert.equal(empty.status,'SEM_INFORMACAO'); assert.equal(empty.total,null);
  assert.equal(salesSplit('SHOPEE',{split:null}).status,'INDISPONIVEL');
  const ml=salesSplit('ML_ANTIGO',{overview:{unlinked:{listings:3}}});
  assert.equal(ml.kind,'ML'); assert.equal(ml.unlinked_listings,3); assert.equal(ml.total,undefined);
});

test('stripCommercial remove faturamento, lucro, margem e ticket em qualquer nível',()=>{
  const x=stripCommercial({units:3,cur_rev:1,revenue:2,gmv:3,lucro:4,profit:5,margem:6,margin:7,ticket_medio:8,faturamento:9,
    nested:[{name:'a',base_rev:1,units:2,deep:{revenue_previous:1,ok:true}}]});
  assert.deepEqual(x,{units:3,nested:[{name:'a',units:2,deep:{ok:true}}]});
  assert.ok(!FORBIDDEN_KEY_RE.test('units')&&!FORBIDDEN_KEY_RE.test('units_previous')&&!FORBIDDEN_KEY_RE.test('conversion_pct'));
});

const parts=(over={})=>{
  const periods=P();
  return {platform:'SHOPEE',days:7,dash:dash({drops:{items:[{listing_id:2,platform:'SHOPEE',external_id:'B2',title:'Anúncio B',units:2,units_previous:10,revenue:50,lost_revenue:40}],total:1}}),
    overview:{listings:{active:3,inactive:1,inactive_with_sales:0,active_without_sales:1},
      top_units:[{listing_id:1,platform:'SHOPEE',external_id:'A1',title:'Anúncio A',units:80,revenue:900,units_previous:50}],
      growth:[{listing_id:1,platform:'SHOPEE',external_id:'A1',title:'Anúncio A',units:80,units_previous:50,revenue:900,revenue_previous:500}],
      stopped:[{listing_id:3,platform:'SHOPEE',external_id:'C3',title:'Anúncio C',units_ever:30,last_sale:'2026-10-01',days_since:53,revenue_ever:300}],
      stopped_total:1,
      no_sales:[{listing_id:4,platform:'SHOPEE',external_id:'D4',title:'Anúncio D',units_ever:0,last_sale:null,units_previous:0},
                {listing_id:3,platform:'SHOPEE',external_id:'C3',title:'Anúncio C',units_ever:30,last_sale:'2026-10-01',units_previous:0}],
      no_sales_total:2,no_sales_never:1,unlinked:{revenue:5,listings:1,revenue_total:9},ads:{rows:[{gmv:1,spend:2}]},coverage:[{platform:'SHOPEE'}]},
    monthly:{months:[{month:'2026-10',shopee:9,units_shopee:120,days_with_sales:31},{month:'2026-11',shopee:8,units_shopee:90,days_with_sales:23}]},
    series:{daily:[{day:'2026-11-22',units_shopee:20,prev_units_shopee:15,prev_revenue:3},{day:'2026-11-23',units_shopee:22,prev_units_shopee:14}]},
    categories:{total:{cur:140,base:100,cur_rev:1,base_rev:1},categories:[{name:'Cat X',cur:90,base:60,cur_rev:5,base_rev:4,cols:[{name:'Col 1',cur:50,base:30,cur_rev:1,base_rev:1}]}]},
    split:{status:'COMPLETO',total_units:140,linked_units:135,unlinked_units:5,unlinked_sku_count:1,base_units:135,
      difference:{units:-5,unlinked_effect_units:-5,other_explained_units:0,residual_units:0,explained:true},
      reconciliation:{status:'EXPLICADA',source_units_match:true,identity_ok:true},coverage:{missing_days:0,days_with_data:7,missing_ranges:[]}},
    dqCurrent:complete('SHOPEE','2026-11-17','2026-11-23',7),dqPrevious:complete('SHOPEE','2026-11-10','2026-11-16',7),
    dqHistory:partial('SHOPEE','2025-01-01','2026-11-23',692),
    perf:{shopee:{reports:[{start:'2026-11-01',end:'2026-11-14'}],items:{A1:{visits:700,impressions:9000,conversion_pct:1.4}}},ml:{reports:[],items:{}}},
    failed:[],periods,...over};
};
const walk=(v,f,path='')=>{if(Array.isArray(v))v.forEach((x,i)=>walk(x,f,path+'['+i+']'));else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){f(k,path);walk(x,f,path+'.'+k);}};

test('visão montada: unidades, situação, campeões, movimentos, evolução, categorias; nada comercial',()=>{
  const v=buildStrategicView(parts());
  assert.equal(v.platform,'SHOPEE'); assert.equal(v.days,7);
  assert.deepEqual({c:v.units.current,p:v.units.previous,ch:v.units.change_pct,v:v.units.verified},{c:140,p:100,ch:40,v:{current:true,previous:true}});
  assert.deepEqual(v.listings,{active:3,inactive:1,inactive_with_sales:0,active_without_sales:1,selling_without_sku:1});
  assert.equal(v.champions[0].external_id,'A1');
  assert.equal(v.champions[0].traffic.visits,700);
  assert.equal(v.movements.growth.items[0].label,'CRESCIMENTO');
  assert.equal(v.movements.drops.items[0].label,'QUEDA');
  assert.equal(v.movements.stopped.items[0].label,'PAROU');
  assert.equal(v.movements.stopped.items[0].last_sale_verified,false);
  assert.equal(v.movements.never.items[0].label,'SEM_VENDAS_HISTORICO_NAO_VERIFICADO');
  assert.equal(v.movements.never.verified,false);
  assert.deepEqual(v.evolution.months.map(m=>[m.month,m.units]),[['2026-10',120],['2026-11',90]]);
  assert.deepEqual(v.evolution.daily.map(d=>[d.day,d.units,d.units_previous]),[['2026-11-22',20,15],['2026-11-23',22,14]]);
  assert.equal(v.categories.items[0].name,'Cat X'); assert.equal(v.categories.items[0].collections[0].name,'Col 1');
  assert.equal(v.sales_split.residual,0);
  assert.equal(v.notices.some(n=>n.kind==='HISTORICO_NAO_VERIFICADO'),true);
  const bad=[]; walk(v,(k,p)=>{if(FORBIDDEN_KEY_RE.test(k))bad.push(p+'.'+k);});
  assert.deepEqual(bad,[]);
  assert.doesNotMatch(JSON.stringify(v,(k,x)=>k==='ordering_note'?undefined:x),/faturamento|lucro|margem|ticket/i); // a única menção é o aviso de como o ranking de queda é escolhido
});

test('sem cobertura do período anterior (30 dias hoje): unidades aparecem, mas nada é classificado',()=>{
  const v=buildStrategicView(parts({days:30,dash:dash({days:30,drops:{items:[{listing_id:2,platform:'SHOPEE',external_id:'B2',title:'Anúncio B',units:2,units_previous:10}],total:1}}),dqPrevious:partial('SHOPEE','2026-09-25','2026-10-24',30)}));
  assert.equal(v.units.verified.previous,false);
  assert.equal(v.movements.growth.items[0].label,'SEM_CLASSIFICACAO');
  assert.equal(v.movements.growth.items[0].reason,'PERIODO_ANTERIOR_NAO_COMPROVADO');
  assert.equal(v.movements.drops.items[0].label,'SEM_CLASSIFICACAO');
  assert.equal(v.movements.stopped.items[0].label,'PAROU'); // atual comprovado
  assert.equal(v.champions.length,1,'histórico/unidades continuam visíveis');
  assert.equal(v.notices.some(n=>n.kind==='PERIODO_ANTERIOR_NAO_COMPROVADO'),true);
});

test('sem nenhuma cobertura: tudo vira "sem classificação", histórico visível e identificado',()=>{
  const v=buildStrategicView(parts({dqCurrent:null,dqPrevious:null,dqHistory:null}));
  for(const r of [...v.movements.growth.items,...v.movements.drops.items,...v.movements.stopped.items])assert.equal(r.label,'SEM_CLASSIFICACAO');
  assert.equal(v.movements.never.items.every(r=>r.label==='SEM_VENDAS_HISTORICO_NAO_VERIFICADO'||r.label==='SEM_CLASSIFICACAO'),true);
  assert.equal(v.units.current,140);
});

test('período sem dados importados: SEM_INFORMACAO, nunca zero',()=>{
  const v=buildStrategicView(parts({dash:dash({totals:null,last_day:null,first_day:null,current_start:null,previous_start:null}),
    overview:null,monthly:null,series:null,categories:null,split:null,periods:null,dqCurrent:null,dqPrevious:null,dqHistory:null}));
  assert.equal(v.units.current,null); assert.equal(v.units.previous,null);
  assert.equal(v.status,'SEM_INFORMACAO');
  assert.equal(v.champions.length,0);
});

test('parte que falha vira indisponível sem derrubar o resto',()=>{
  const v=buildStrategicView(parts({categories:null,failed:['categories']}));
  assert.equal(v.parts.categories,'INDISPONIVEL'); assert.equal(v.parts.overview,'OK');
  assert.equal(v.categories,null); assert.equal(v.units.current,140);
});

test('ML: sem divisão total x vinculada e sem impressões inventadas',()=>{
  const v=buildStrategicView(parts({platform:'ML_NOVO',split:null,
    dash:dash({platform:'ML_NOVO'}),
    overview:{...parts().overview,top_units:[{listing_id:9,platform:'ML_NOVO',external_id:'MLB1',title:'ML A',units:5,units_previous:4}],growth:[],stopped:[],stopped_total:0,no_sales:[],no_sales_total:0,no_sales_never:0},
    dqCurrent:complete('ML_NOVO','2026-11-17','2026-11-23',7),dqPrevious:complete('ML_NOVO','2026-11-10','2026-11-16',7),dqHistory:null,
    perf:{shopee:{reports:[],items:{}},ml:{reports:[{account:'NOVO',start:'2026-11-01',end:'2026-11-14'}],items:{MLB1:{account:'NOVO',visits:40,conversion_pct:2.5,gross:9}}}}}));
  assert.equal(v.sales_split.kind,'ML');
  assert.equal(v.champions[0].traffic.visits,40);
  assert.equal(v.champions[0].traffic.impressions,null);
});

test('isolamento: item de outra conta no overview nunca entra',()=>{
  const p=parts({platform:'ML_ANTIGO',dash:dash({platform:'ML_ANTIGO'}),split:null});
  p.overview.top_units=[{platform:'ML_NOVO',external_id:'X',title:'de outra conta',units:9,units_previous:1},
                        {platform:'ML_ANTIGO',external_id:'Y',title:'da conta',units:3,units_previous:1}];
  p.overview.growth=[{platform:'SHOPEE',external_id:'G',title:'outra',units:50,units_previous:10}];
  const v=buildStrategicView(p);
  assert.deepEqual(v.champions.map(c=>c.external_id),['Y']);
  assert.equal(v.movements.growth.items.length,0);
});
