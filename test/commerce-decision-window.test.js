// GA-014 — decisão final do Atlas sobre os períodos: janela encerrada no último dia COMPLETO comprovado (por conta), períodos iguais e sem
// sobreposição, conciliação com as datas exatas da Central, dois motivos de bloqueio e idade dos relatórios medida a partir de hoje.
import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisWindow,validateWindow,buildDecisionCenter,sumDailySource} from '../src/ga/commerce-decision-logic.js';
import {facts,winOf,dq,row,units,reports,splitOf,sourceOf,mk,tierOf,get,confirmedTotal,TODAY} from './fixtures-decision.js';

const span=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000)+1;
const rows=()=>[row('A',10,30),row('B',3,3),row('C',40,5)];

test('janela: encerra no último dia completo, não na última data importada; períodos iguais, contíguos e sem sobreposição',()=>{
  for(const days of [7,30]){
    const w=winOf(days);
    assert.equal(w.end,'2026-11-23'); assert.equal(w.last_import_day,'2026-11-24'); assert.equal(w.last_complete_day,'2026-11-23');
    assert.equal(span(w.current.start,w.current.end),days); assert.equal(span(w.previous.start,w.previous.end),days);
    assert.ok(w.previous.end<w.current.start,'sem sobreposição'); assert.equal(Date.parse(w.current.start)-Date.parse(w.previous.end),86400000,'contíguos');
    assert.equal(validateWindow(w,{days}).ok,true);
  }
  const w7=winOf(7); assert.deepEqual([w7.current,w7.previous],[{start:'2026-11-17',end:'2026-11-23'},{start:'2026-11-10',end:'2026-11-16'}]);
  const w30=winOf(30); assert.deepEqual([w30.current,w30.previous],[{start:'2026-10-25',end:'2026-11-23'},{start:'2026-09-25',end:'2026-10-24'}]);
});

test('último dia com vendas NÃO é o último dia completo: dia completo sem vendas depois da última venda vira o fim da janela',()=>{
  const w=winOf(7,{last_import_day:'2026-11-22',last_complete_day:'2026-11-24',skipped:[]});
  assert.equal(w.end,'2026-11-24'); assert.equal(w.last_import_day,'2026-11-22'); assert.equal(w.current.end,'2026-11-24');
  const partialLast=winOf(7,{last_import_day:'2026-11-24',last_complete_day:'2026-11-22',skipped:[{day:'2026-11-24',state:'PARCIAL'},{day:'2026-11-23',state:'PARCIAL'}]});
  assert.equal(partialLast.end,'2026-11-22');
});

test('janela: contas com datas de encerramento diferentes têm janelas diferentes',()=>{
  const a=winOf(7,{last_complete_day:'2026-11-23'}),b=winOf(7,{last_complete_day:'2026-11-21',skipped:[{day:'2026-11-23',state:'SEM_INFORMACAO'},{day:'2026-11-22',state:'PARCIAL'}]});
  assert.notEqual(a.current.end,b.current.end); assert.equal(b.current.end,'2026-11-21'); assert.equal(b.previous.end,'2026-11-14');
});

test('janela: hoje, futuro ou dado inválido não vira período',()=>{
  for(const [why,f] of [['hoje',{last_complete_day:TODAY}],['futuro',{last_complete_day:'2026-11-30'}],['data inválida',{last_complete_day:'2026-13-45'}],['hoje inválido',{today:'ontem'}]])
    assert.equal(analysisWindow(facts(f),7).ok,false,why);
  assert.equal(analysisWindow(facts(),14).ok,false,'dias não suportados');
  assert.equal(analysisWindow(facts({last_complete_day:null,last_import_day:null}),7).ok,false,'sem vendas importadas');
  const w=winOf(7);
  for(const [why,bad] of [['tamanho',{...w,current:{start:'2026-11-18',end:'2026-11-23'}}],['sobreposição',{...w,previous:{start:'2026-11-12',end:'2026-11-18'}}],['lacuna',{...w,previous:{start:'2026-11-09',end:'2026-11-15'}}],
    ['fim ≥ hoje',{...w,today:'2026-11-23'}],['completo diferente do fim',{...w,last_complete_day:'2026-11-22'}]])
    assert.equal(validateWindow(bad,{days:7}).ok,false,why);
});

test('sem nenhum dia completo: janela termina no último dia importado (antes de hoje) e tudo fica como candidato',()=>{
  const w=winOf(7,{last_complete_day:null,skipped:[{day:'2026-11-24',state:'PARCIAL'},{day:'2026-11-23',state:'SEM_INFORMACAO'}],probes:14});
  assert.equal(w.basis,'SEM_DIA_COMPLETO'); assert.equal(w.end,'2026-11-24');
  const v=buildDecisionCenter(mk(rows(),{window:w,dqCurrent:dq('SHOPEE',w.current.start,w.current.end,false),dqPrevious:dq('SHOPEE',w.previous.start,w.previous.end,false)}));
  assert.equal(confirmedTotal(v),0); assert.equal(v.tiers.insuficiente.total,3);
  assert.ok(v.notices.some(n=>n.kind==='SEM_DIA_COMPLETO'&&n.essential));
  assert.equal(v.window.basis,'SEM_DIA_COMPLETO'); assert.equal(v.window.last_complete_day,null);
});

test('saída informa última data importada, última data comprovada e as datas efetivamente analisadas',()=>{
  const v=buildDecisionCenter(mk(rows()));
  assert.equal(v.window.last_import_day,'2026-11-24'); assert.equal(v.window.last_complete_day,'2026-11-23'); assert.equal(v.window.today,TODAY);
  assert.deepEqual(v.window.analyzed,{current:{start:'2026-11-17',end:'2026-11-23'},previous:{start:'2026-11-10',end:'2026-11-16'}});
  assert.deepEqual(v.periods,v.window.analyzed); assert.deepEqual(v.window.skipped,[{day:'2026-11-24',state:'PARCIAL'}]);
  assert.equal(tierOf(v,'A'),'alta'); assert.equal(v.blocked_confirmations,false);
});

test('lacuna histórica dentro da janela: períodos continuam iguais, mas a cobertura não é comprovada e nada é confirmado',()=>{
  const w=winOf(7);
  const v=buildDecisionCenter(mk(rows(),{dqPrevious:dq('SHOPEE',w.previous.start,w.previous.end,false)}));
  assert.equal(v.coverage.previous.proven,false); assert.equal(confirmedTotal(v),0); assert.equal(tierOf(v,'A'),'insuficiente');
});

test('idade do relatório vem de HOJE, não do fim da janela deslocada',()=>{
  const rep=reports(['2026-11-04','2026-11-10'],null); // termina 15 dias antes de hoje (25/11) e só 13 antes do fim da janela (23/11)
  const v=buildDecisionCenter(mk(rows(),{units:{reports:rep}}));
  assert.equal(v.evidence.latest.age_days,15); assert.equal(v.evidence.latest.fresh,false); assert.equal(v.evidence.latest.stale,true);
  assert.match(v.evidence.latest.text,/antes de hoje/);
  const fresh=buildDecisionCenter(mk(rows(),{units:{reports:reports(['2026-11-12','2026-11-18'],null)}}));
  assert.equal(fresh.evidence.latest.age_days,7); assert.equal(fresh.evidence.latest.fresh,true);
  const edge=buildDecisionCenter(mk(rows(),{units:{reports:reports(['2026-11-05','2026-11-11'],null)}}));
  assert.equal(edge.evidence.latest.age_days,14); assert.equal(edge.evidence.latest.fresh,true,'14 dias ainda vale');
});

test('GA-019: total da fonte diária nas datas exatas; divergência bloqueia com motivo de divergência',()=>{
  const base=mk(rows()); const w=base.window;
  const ok=buildDecisionCenter(base);
  assert.equal(ok.reconciliation.ga019.status,'CONCILIADO'); assert.equal(ok.blocked_confirmations,false); assert.equal(ok.reconciliation.blocked_kind,null);
  const v=buildDecisionCenter({...base,source:sourceOf(base.units,w,{current:{units:base.units.reconciliation.current.source_units+7}})});
  assert.equal(v.blocked_confirmations,true); assert.equal(v.reconciliation.blocked_kind,'DIVERGENTE'); assert.equal(v.reconciliation.ga019.current.status,'DIVERGENTE');
  assert.equal(confirmedTotal(v),0); assert.ok(v.notices.some(n=>n.kind==='UNIDADES_DIVERGENTES'&&n.essential)); assert.ok(!v.notices.some(n=>n.kind==='CONCILIACAO_INDISPONIVEL'));
  assert.deepEqual(get(v,'A').missing.filter(m=>m.startsWith('CONCILIACAO')),['CONCILIACAO_DIVERGENTE']);
});

test('GA-019 indisponível ou de outras datas: bloqueia com motivo de INDISPONIBILIDADE, distinto de divergência',()=>{
  const base=mk(rows()); const w=base.window;
  for(const [why,src,failed] of [['consulta falhou',null,['source']],['sem a resposta',null,[]],['datas diferentes das da Central',{...sourceOf(base.units,w),current:{start:'2026-11-18',end:'2026-11-24',units:50}},[]]]){
    const v=buildDecisionCenter({...base,source:src,failed});
    assert.equal(v.blocked_confirmations,true,why); assert.equal(v.reconciliation.blocked_kind,'INDISPONIVEL',why); assert.equal(confirmedTotal(v),0,why);
    assert.ok(v.notices.some(n=>n.kind==='CONCILIACAO_INDISPONIVEL'&&n.essential),why); assert.ok(!v.notices.some(n=>n.kind==='UNIDADES_DIVERGENTES'),why);
    assert.deepEqual(get(v,'A').missing.filter(m=>m.startsWith('CONCILIACAO')),['CONCILIACAO_INDISPONIVEL'],why);
  }
});

test('divergência e indisponibilidade ao mesmo tempo: os dois motivos aparecem, sem se confundir',()=>{
  const base=mk(rows(),{platform:'SHOPEE'}); const w=base.window;
  const split={current:splitOf(w.current.start,w.current.end,{total:60,linked:53,residual:4}),previous:null};
  const v=buildDecisionCenter({...base,split});
  assert.equal(v.reconciliation.blocked_kind,'DIVERGENTE_E_INDISPONIVEL'); assert.ok(v.notices.some(n=>n.kind==='UNIDADES_DIVERGENTES'));
  assert.ok(v.notices.some(n=>n.kind==='CONCILIACAO_INDISPONIVEL')); assert.equal(confirmedTotal(v),0);
});

test('Shopee: divisão por SKU indisponível em um dos períodos bloqueia (antes só avisava); fechada nos dois não bloqueia',()=>{
  const base=mk(rows()); const w=base.window; const u=base.units.totals;
  const good={current:splitOf(w.current.start,w.current.end,{total:u.units_current+4,linked:u.units_current}),previous:splitOf(w.previous.start,w.previous.end,{total:u.units_previous+4,linked:u.units_previous})};
  assert.equal(buildDecisionCenter({...base,split:good}).blocked_confirmations,false);
  const v=buildDecisionCenter({...base,split:{...good,previous:null}});
  assert.equal(v.blocked_confirmations,true); assert.equal(v.reconciliation.blocked_kind,'INDISPONIVEL');
  const wrongDates=buildDecisionCenter({...base,split:{...good,current:splitOf('2026-11-18','2026-11-24',{total:60,linked:56})}});
  assert.equal(wrongDates.reconciliation.blocked_kind,'INDISPONIVEL','resposta de outras datas não concilia');
});

test('sumDailySource: soma só as datas de cada período; resposta inválida ou duplicada não vira total',()=>{
  const w=winOf(7);
  const rows=[];for(let d=10;d<=24;d++)rows.push({sale_date:'2026-11-'+d,units:2});
  const t=sumDailySource(rows,w);
  assert.deepEqual(t,{current:{start:'2026-11-17',end:'2026-11-23',units:14},previous:{start:'2026-11-10',end:'2026-11-16',units:14}});
  assert.equal(sumDailySource([...rows,{sale_date:'2026-11-17',units:1}],w),null,'dia duplicado');
  assert.equal(sumDailySource([{sale_date:'2026-11-17',units:-1}],w),null,'unidades negativas');
  assert.equal(sumDailySource([{sale_date:'17/11',units:1}],w),null,'data inválida');
  assert.equal(sumDailySource({rows:[]},w),null,'formato inesperado');
  assert.deepEqual(sumDailySource([],w),{current:{start:'2026-11-17',end:'2026-11-23',units:0},previous:{start:'2026-11-10',end:'2026-11-16',units:0}},'sem vendas é zero na fonte (a cobertura decide se é prova)');
});

test('Shopee: a GA-019 pode ter unidades a mais que a view SÓ se a GA-021 explica a diferença por completo (caso real: 1 a 4 un sem vínculo)',()=>{
  const base=mk(rows()); const w=base.window; const sc=base.units.reconciliation.current.source_units,sp=base.units.reconciliation.previous.source_units;
  const src=(c,p)=>sourceOf(base.units,w,{current:{units:c},previous:{units:p}});
  const split=(c,p)=>({current:splitOf(w.current.start,w.current.end,c),previous:splitOf(w.previous.start,w.previous.end,p)});
  const ok=buildDecisionCenter({...base,source:src(sc+4,sp+1),split:split({total:sc+4,linked:sc},{total:sp+1,linked:sp})});
  assert.equal(ok.reconciliation.ga019.status,'CONCILIADO'); assert.equal(ok.reconciliation.ga019.current.explained_by,'GA-021'); assert.equal(ok.blocked_confirmations,false);
  assert.equal(tierOf(ok,'A'),'alta');
  const residual=buildDecisionCenter({...base,source:src(sc+4,sp),split:split({total:sc+4,linked:sc,residual:2},{total:sp,linked:sp})});
  assert.equal(residual.reconciliation.blocked_kind,'DIVERGENTE','resíduo não explicado continua divergência');
  const otherTotal=buildDecisionCenter({...base,source:src(sc+4,sp),split:split({total:sc+9,linked:sc+5},{total:sp,linked:sp})});
  assert.equal(otherTotal.reconciliation.ga019.current.status,'DIVERGENTE','a GA-021 precisa ter o mesmo total da GA-019 nessas datas');
  const noSplit=buildDecisionCenter({...base,source:src(sc+4,sp),split:null});
  assert.equal(noSplit.reconciliation.blocked_kind,'DIVERGENTE_E_INDISPONIVEL','diferença sem a GA-021 para explicá-la: divergente, e a GA-021 está indisponível');
  const ml=buildDecisionCenter({...mk(rows(),{platform:'ML_NOVO',split:null,units:{platform:'ML_NOVO'}}),source:src(sc+4,sp)});
  assert.equal(ml.reconciliation.blocked_kind,'DIVERGENTE','só a Shopee tem GA-021 para explicar diferença');
});
