// GA-014 — revisão técnica (itens 4 a 7): cobertura dos dois períodos, bloqueio por divergência, validação do Dashboard e dos relatórios.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionCenter} from '../src/ga/commerce-decision-logic.js';
import {strategicPeriods} from '../src/ga/commerce-strategic-logic.js';
import {dash,dq,row,units,reports,perfOf,splitOf,mk,tierOf,get,confirmedTotal} from './fixtures-decision.js';

const prevUnproven=o=>({dqPrevious:dq('SHOPEE','2026-11-10','2026-11-16',false),...o});
const curUnproven=o=>({dqCurrent:dq('SHOPEE','2026-11-17','2026-11-23',false),...o});

// ---- Item 4: perda de unidades exige cobertura dos DOIS períodos ----
test('item 4: parada e queda só são confirmadas com os dois períodos comprovados',()=>{
  const rows=[row('STOP',0,12),row('DROP',5,20),row('OK',10,10)];
  const both=buildDecisionCenter(mk(rows));
  assert.equal(tierOf(both,'STOP'),'alta'); assert.equal(get(both,'STOP').kind,'PAROU'); assert.equal(tierOf(both,'DROP'),'alta');
  const cur=buildDecisionCenter(mk(rows,prevUnproven()));
  for(const e of ['STOP','DROP']){assert.equal(tierOf(cur,e),'insuficiente',e+' não pode ser prioridade confirmada sem o período anterior'); assert.ok(get(cur,e).missing.includes('PERIODO_ANTERIOR'));}
  assert.equal(get(cur,'STOP').kind,'POSSIVEL_PARADA'); assert.equal(cur.tiers.alta.total+cur.tiers.revisao.total,0);
  const none=buildDecisionCenter(mk(rows,curUnproven(prevUnproven())));
  assert.equal(none.tiers.alta.total+none.tiers.revisao.total+none.tiers.oportunidade.total,0);
});

test('item 4: ausência de vendas no período atual comprovada aparece como fato separado, sem confirmar o impacto',()=>{
  const v=buildDecisionCenter(mk([row('STOP',0,12),row('DROP',5,20)],prevUnproven()));
  const s=get(v,'STOP');
  assert.deepEqual(s.proven_facts,['SEM_VENDAS_PERIODO_ATUAL']);
  assert.match(s.facts.join(' '),/sem vendas no período atual.*comprovad/i);
  assert.match(s.reason,/período anterior.*não.*comprovad/i); assert.doesNotMatch(s.reason,/^Parou de vender/);
  assert.equal(get(v,'DROP').proven_facts,undefined,'queda parcial não é ausência de vendas');
  const unprovenNow=buildDecisionCenter(mk([row('STOP',0,12)],curUnproven()));
  assert.equal(get(unprovenNow,'STOP').proven_facts,undefined,'sem cobertura do atual, a ausência também não é comprovada');
  assert.equal(v.summary.proven_no_sales_current,1,'contagem separada do fato comprovado');
});

// ---- Item 5: divergência de conciliação bloqueia classificações confirmadas ----
test('item 5: divergência com o Dashboard (atual OU anterior) bloqueia toda classificação confirmada',()=>{
  const rows=[row('A',10,30),row('B',20,5),row('C',10,10)];
  for(const bad of [{cur_units:99,prev_units:45},{cur_units:40,prev_units:99}]){
    const v=buildDecisionCenter(mk(rows,{dash:dash({totals:bad})}));
    assert.equal(confirmedTotal(v),0,'nada confirmado'); assert.equal(v.blocked_confirmations,true);
    assert.equal(tierOf(v,'A'),'insuficiente'); assert.ok(get(v,'A').missing.includes('CONCILIACAO'));
    assert.ok(v.notices.some(n=>n.kind==='UNIDADES_DIVERGENTES'&&n.essential&&/bloquead|não confirm/i.test(n.text)));
  }
  const ok=buildDecisionCenter(mk(rows)); assert.equal(ok.blocked_confirmations,false); assert.equal(tierOf(ok,'A'),'alta');
});

test('item 5: divisão por SKU da Shopee é conferida nos DOIS períodos; resíduo ou base divergente bloqueia',()=>{
  const rows=[row('A',10,30),row('B',5,5)];
  const split=(c,p)=>({current:c,previous:p});
  const good=split(splitOf('2026-11-17','2026-11-23',{total:20,linked:15}),splitOf('2026-11-10','2026-11-16',{total:45,linked:35}));
  const ok=buildDecisionCenter(mk(rows,{split:good}));
  assert.equal(ok.blocked_confirmations,false); assert.equal(tierOf(ok,'A'),'alta');
  assert.deepEqual([ok.reconciliation.breakdown.current.unlinked_sku_units,ok.reconciliation.breakdown.previous.unlinked_sku_units],[5,10],'sem vínculo separado, não distribuído');
  const badPrev=buildDecisionCenter(mk(rows,{split:split(good.current,splitOf('2026-11-10','2026-11-16',{total:45,linked:35,base:60}))}));
  assert.equal(badPrev.blocked_confirmations,true); assert.equal(badPrev.reconciliation.shopee.previous.status,'DIVERGENTE');
  const residue=buildDecisionCenter(mk(rows,{split:split(splitOf('2026-11-17','2026-11-23',{total:20,linked:15,residual:3}),good.previous)}));
  assert.equal(residue.blocked_confirmations,true); assert.equal(residue.reconciliation.shopee.current.status,'RESIDUO_NAO_EXPLICADO');
  const wrongDates=buildDecisionCenter(mk(rows,{split:split(good.current,splitOf('2026-11-09','2026-11-16',{total:45,linked:35}))}));
  assert.equal(wrongDates.reconciliation.shopee.previous.status,'RESPOSTA_INVALIDA'); assert.equal(wrongDates.blocked_confirmations,true);
  const missing=buildDecisionCenter(mk(rows,{split:null}));
  assert.equal(missing.blocked_confirmations,false,'conciliação indisponível não é divergência');
  assert.ok(missing.notices.some(n=>n.kind==='CONCILIACAO_INDISPONIVEL'&&!n.essential));
});

test('item 5: a conciliação do banco separa sem vínculo, sem cadastro e resíduo; resíduo do banco bloqueia',()=>{
  const rows=[row('A',10,30),row('U',6,0,{registered:false,status:null,title:null,listing_id:null})];
  const v=buildDecisionCenter(mk(rows,{units:{noid:{current:4,previous:1}}}));
  assert.deepEqual([v.reconciliation.breakdown.current.units_without_id,v.reconciliation.breakdown.current.units_unregistered,v.reconciliation.breakdown.current.unexplained_units],[4,6,0]);
  assert.equal(v.reconciliation.breakdown.previous.units_without_id,1);
  assert.equal(v.blocked_confirmations,false);
  const u=units(rows); u.reconciliation={...u.reconciliation,status:'RESIDUO_NAO_EXPLICADO',current:{...u.reconciliation.current,unexplained_units:3}};
  const b=buildDecisionCenter({...mk(rows),units:u});
  assert.equal(b.blocked_confirmations,true); assert.equal(confirmedTotal(b),0); assert.equal(b.reconciliation.breakdown.current.unexplained_units,3);
});

test('item 5: a soma das linhas devolvidas é conferida contra os totais da função (falha fechada)',()=>{
  const rows=[row('A',10,30),row('B',5,5)];
  const cases={'unidades atuais':u=>{u.totals.units_current+=1;},'unidades anteriores':u=>{u.totals.units_previous-=1;},'número de anúncios':u=>{u.totals.listings+=1;},
    'linhas vs row_count':u=>{u.row_count+=1;},'linhas das unidades sem cadastro':u=>{u.totals.units_current_unregistered=2;}};
  for(const [name,mut] of Object.entries(cases)){
    const u=units(rows); mut(u);
    const v=buildDecisionCenter({...mk(rows),units:u});
    assert.equal(v.parts.units,'RESPOSTA_INVALIDA',name); assert.equal(v.status,'INDISPONIVEL',name); assert.equal(confirmedTotal(v)+v.tiers.insuficiente.total,0,name);
  }
});

// ---- Item 6: ausência de prioridade só é comprovada com cobertura ----
test('item 6: sem sinal só vira "sem prioridade comercial" com os dois períodos comprovados',()=>{
  const rows=[row('S',10,10),row('Z',0,0),row('L',1,2)];
  const ok=buildDecisionCenter(mk(rows));
  assert.deepEqual(['S','Z','L'].map(e=>tierOf(ok,e)),['sem_prioridade','sem_prioridade','sem_prioridade']);
  assert.equal(get(ok,'Z').kind,'SEM_VENDAS_COMPROVADO');
  for(const o of [prevUnproven(),curUnproven(),curUnproven(prevUnproven())]){
    const v=buildDecisionCenter(mk(rows,o));
    assert.equal(v.tiers.sem_prioridade.total,0,'ausência de prioridade não é comprovada sem cobertura');
    assert.deepEqual(['S','Z','L'].map(e=>tierOf(v,e)),['insuficiente','insuficiente','insuficiente']);
    assert.equal(get(v,'S').kind,'SEM_SINAL_NAO_COMPROVADO'); assert.match(get(v,'Z').reason,/não .*zero|não comprovad/i);
  }
});

// ---- Item 7: Dashboard e relatórios validados antes de usar ----
test('item 7: períodos do Dashboard são validados (conta, dias, datas, tamanho e continuidade) antes de classificar',()=>{
  const rows=[row('A',10,30)];
  const bad={'outra conta':dash({platform:'ML_NOVO'}),'dias diferentes':dash({days:30}),'dias ausentes':dash({days:undefined}),'atual maior que os dias':dash({current_start:'2026-11-16'}),
    'atual menor que os dias':dash({current_start:'2026-11-18'}),'anterior sem continuidade':dash({previous_start:'2026-11-09'}),'anterior colado errado':dash({previous_start:'2026-11-11'}),
    'data inválida':dash({last_day:'2026-13-45'}),'histórico depois do atual':dash({first_day:'2026-11-20'}),'último dia no futuro do início':dash({last_day:'2026-11-10'})};
  for(const [name,d] of Object.entries(bad)){
    const v=buildDecisionCenter({...mk(rows),dash:{...d,totals:{cur_units:10,prev_units:30}},periods:strategicPeriods(d)});
    assert.equal(v.status,'INDISPONIVEL',name); assert.equal(v.parts.dashboard,'RESPOSTA_INVALIDA',name); assert.equal(Object.values(v.tiers).reduce((a,t)=>a+t.total,0),0,name);
    assert.ok(v.notices.some(n=>n.kind==='FONTE_INVALIDA'&&n.essential),name);
  }
  assert.equal(buildDecisionCenter(mk(rows)).status,'OK');
  const d30={...dash({days:30,current_start:'2026-10-26',previous_start:'2026-09-26',last_day:'2026-11-24'}),totals:{cur_units:10,prev_units:30}};
  const u30=units(rows); u30.current={start:'2026-10-26',end:'2026-11-24'}; u30.previous={start:'2026-09-26',end:'2026-10-25'};
  const v30=buildDecisionCenter({platform:'SHOPEE',days:30,dash:d30,periods:strategicPeriods(d30),units:u30,dqCurrent:dq('SHOPEE','2026-10-26','2026-11-24'),dqPrevious:dq('SHOPEE','2026-09-26','2026-10-25'),split:null,failed:[]});
  assert.equal(v30.status,'OK','janelas reais do Dashboard de 30 dias (26/10–24/11 e 26/09–25/10) são aceitas');
});

const withReports=(rows,l,p)=>buildDecisionCenter(mk(rows,{units:{reports:reports(l,p)}}));
const dropRow=(pl,pp)=>row('A',10,30,{in_report:true,perf:{latest:pl,previous:pp}});
const visib=v=>get(v,'A').hypotheses.find(h=>h.kind==='VISIBILIDADE_MENOR');

test('item 7: relatórios comparativos exigem datas válidas, sem sobreposição e próximos no tempo',()=>{
  const L=['2026-11-16','2026-11-22'],P=['2026-10-06','2026-11-04'];
  const mkRow=(ld=7,pd=30)=>dropRow(perfOf(ld,{imp:1400,clk:100,vis:200,ord:5}),perfOf(pd,{imp:12000,clk:900,vis:900,ord:30}));
  assert.ok(visib(withReports([mkRow()],L,P)),'caso válido (7 dias contra 30, intervalo de 11 dias)');
  const cases={'sobreposição':[L,['2026-10-20','2026-11-17']],'termina no dia em que o recente começa':[L,['2026-10-20','2026-11-16']],
    'distantes demais':[L,['2026-08-01','2026-09-10']],'data inválida':[L,['2026-13-01','2026-11-04']],'fim antes do início':[L,['2026-11-04','2026-10-06']],
    'anterior depois do recente':[L,['2026-11-23','2026-11-30']],'relatório de 1 dia':[['2026-11-22','2026-11-22'],P]};
  for(const [name,[l,p]] of Object.entries(cases)){
    const v=withReports([mkRow()],l,p);
    assert.equal(visib(v),undefined,name); assert.equal(v.evidence.previous.comparable,false,name);
  }
  const noFlag=buildDecisionCenter(mk([mkRow()],{units:{reports:{...reports(L,P),comparable:{ok:false,reason:'SEM_RELATORIO_ANTERIOR'}}}}));
  assert.equal(visib(noFlag),undefined,'a marca comparable=false do banco também vale');
  const wrongDays=buildDecisionCenter(mk([mkRow()],{units:{reports:{...reports(L,P),latest:{...reports(L,P).latest,days:9}}}}));
  assert.equal(visib(wrongDays),undefined,'dias informados diferentes das datas: relatório incoerente');
});

test('item 7: durações diferentes são comparadas POR DIA, nunca pelo total bruto',()=>{
  const L=['2026-11-16','2026-11-22'],P=['2026-10-06','2026-11-04'];
  // Bruto: 700 contra 1500 parece queda de 53%; por dia: 100 contra 50 é alta de 100%.
  const up=withReports([dropRow(perfOf(7,{imp:1400,clk:100,vis:200,ord:5}),perfOf(30,{imp:1500,clk:60,vis:150,ord:5}))],L,P);
  assert.equal(visib(up),undefined,'o total bruto menor não pode virar queda');
  // Bruto: 1400 contra 3000 (−53%); por dia: 200 contra 100 (alta). E o caso real de queda por dia:
  const down=withReports([dropRow(perfOf(7,{imp:1400,clk:100,vis:200,ord:5}),perfOf(30,{imp:12000,clk:900,vis:900,ord:30}))],L,P);
  const h=visib(down); assert.ok(h); assert.equal(h.change_pct,-50); assert.match(h.text,/por dia/i); assert.match(h.text,/pode indicar/i);
  const noPerDay=withReports([dropRow({...perfOf(7,{imp:1400,clk:100,vis:200,ord:5}),impressions_per_day:null},perfOf(30,{imp:12000,clk:900,vis:900,ord:30}))],L,P);
  assert.equal(visib(noPerDay),undefined,'sem valor por dia, sem hipótese');
});
