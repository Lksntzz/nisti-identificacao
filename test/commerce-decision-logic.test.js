// GA-014 — regras puras da Central de decisões comerciais. Dados 100% fictícios, nos formatos REAIS das respostas
// (função commerce_decision_units_v1, Dashboard e GA-018). Só unidades; nenhuma tela ou rota aqui.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FORBIDDEN_KEY_RE} from '../src/ga/commerce-strategic-logic.js';
import {buildDecisionCenter,DECISION_DAYS,DECISION_THRESHOLDS,isDecisionDays,TIER_LIMIT} from '../src/ga/commerce-decision-logic.js';

import {dash,dq,row,units,reports,perfOf,splitOf,mk,tierOf,get} from './fixtures-decision.js';

test('janelas: só 7 e 30 dias, com limiares próprios',()=>{
  assert.deepEqual([...DECISION_DAYS],[7,30]); assert.equal(isDecisionDays(7),true); assert.equal(isDecisionDays(60),false);
  assert.deepEqual(DECISION_THRESHOLDS[7],{drop_pct:30,high_loss:5,review_loss:2,high_loss_abs:20,gain:5,small_base:2});
  assert.deepEqual(DECISION_THRESHOLDS[30],{drop_pct:30,high_loss:10,review_loss:4,high_loss_abs:60,gain:10,small_base:4});
});

test('prioridade alta por perda percentual e por perda absoluta independente do percentual',()=>{
  const v=buildDecisionCenter(mk([row('A',10,20),row('B',178,200),row('C',9,10),row('D',8,10)]));
  assert.equal(tierOf(v,'A'),'alta'); assert.deepEqual(get(v,'A').rules,['PERCENTUAL']); assert.equal(get(v,'A').impact_units,-10);
  assert.equal(tierOf(v,'B'),'alta','200→178 cai só 11%, mas perde 22 un (≥20)'); assert.deepEqual(get(v,'B').rules,['ABSOLUTA']); assert.equal(get(v,'B').pct_change,-11);
  assert.equal(tierOf(v,'C'),'sem_prioridade','perda de 1 un'); assert.equal(tierOf(v,'D'),'sem_prioridade','perda de 2 un com queda de só 20%');
  const w=buildDecisionCenter(mk([row('X',341,400),row('Y',340,400)],{days:30}));
  assert.equal(tierOf(w,'X'),'sem_prioridade','em 30 dias perder 59 un (15%) ainda não é alta'); assert.equal(tierOf(w,'Y'),'alta'); assert.deepEqual(get(w,'Y').rules,['ABSOLUTA']);
});

test('queda e ganho percentual e absoluto aparecem juntos quando valem as duas regras',()=>{
  const v=buildDecisionCenter(mk([row('A',30,100)])); assert.deepEqual(get(v,'A').rules,['PERCENTUAL','ABSOLUTA']);
});

test('revisão: queda de 30% ou mais entre a perda mínima de revisão e a de alta',()=>{
  const v=buildDecisionCenter(mk([row('R',5,8),row('S',6,8)]));
  assert.equal(tierOf(v,'R'),'revisao'); assert.equal(get(v,'R').impact_units,-3);
  assert.equal(tierOf(v,'S'),'sem_prioridade','queda de 25% e 2 un: sem sinal');
});

test('oportunidade comprovada: crescimento percentual e saída de zero ou de base pequena, sem inventar porcentagem',()=>{
  const v=buildDecisionCenter(mk([row('G',20,10),row('N',8,0),row('P',7,1),row('Q',4,0)]));
  assert.equal(tierOf(v,'G'),'oportunidade'); assert.equal(get(v,'G').pct_change,100); assert.equal(get(v,'G').impact_units,10);
  assert.equal(tierOf(v,'N'),'oportunidade'); assert.equal(get(v,'N').kind,'NOVA_OU_RETOMADA'); assert.equal(get(v,'N').pct_change,null,'base zero: sem porcentagem');
  assert.equal(tierOf(v,'P'),'oportunidade'); assert.equal(get(v,'P').pct_change,null,'base pequena: sem porcentagem'); assert.equal(get(v,'P').kind,'NOVA_OU_RETOMADA');
  assert.equal(tierOf(v,'Q'),'sem_prioridade','4 un de uma base zero ainda é pouco');
});

test('cobertura determina as classificações dinamicamente (nada fixo)',()=>{
  const rows=[row('A',10,20),row('B',0,6),row('C',20,10),row('S',10,10)];
  const all=buildDecisionCenter(mk(rows)); assert.equal(tierOf(all,'A'),'alta'); assert.equal(tierOf(all,'B'),'alta'); assert.equal(tierOf(all,'C'),'oportunidade');
  const noPrev=buildDecisionCenter(mk(rows,{dqPrevious:dq('SHOPEE','2026-11-10','2026-11-16',false)}));
  assert.equal(tierOf(noPrev,'A'),'insuficiente'); assert.equal(get(noPrev,'A').kind,'POSSIVEL_QUEDA'); assert.deepEqual(get(noPrev,'A').missing,['PERIODO_ANTERIOR']);
  assert.equal(tierOf(noPrev,'B'),'insuficiente','parada também exige o período anterior (a ausência atual aparece como fato separado)'); assert.equal(get(noPrev,'B').kind,'POSSIVEL_PARADA');
  assert.deepEqual(get(noPrev,'B').proven_facts,['SEM_VENDAS_PERIODO_ATUAL']);
  assert.equal(tierOf(noPrev,'C'),'insuficiente'); assert.equal(get(noPrev,'C').kind,'POSSIVEL_OPORTUNIDADE');
  const noCur=buildDecisionCenter(mk(rows,{dqCurrent:dq('SHOPEE','2026-11-17','2026-11-23',false)}));
  assert.equal(tierOf(noCur,'B'),'insuficiente'); assert.deepEqual(get(noCur,'B').missing,['PERIODO_ATUAL']); assert.equal(get(noCur,'B').kind,'POSSIVEL_PARADA');
  assert.deepEqual(get(noCur,'A').missing,['PERIODO_ATUAL','PERIODO_ANTERIOR'].filter(x=>x==='PERIODO_ATUAL'));
  const none=buildDecisionCenter(mk(rows,{dqCurrent:null,dqPrevious:null}));
  assert.equal(none.tiers.alta.total,0); assert.equal(none.tiers.oportunidade.total,0);
  assert.equal(tierOf(none,'S'),'insuficiente','sem cobertura, a ausência de prioridade não é comprovada'); assert.equal(get(none,'S').kind,'SEM_SINAL_NAO_COMPROVADO');
  assert.ok(!['alta','revisao','oportunidade'].some(t=>none.tiers[t].rows.length),'nada é confirmado sem cobertura');
});

test('sem prioridade comercial ≠ dados insuficientes',()=>{
  const v=buildDecisionCenter(mk([row('S',10,10),row('L',1,2)]));
  assert.equal(tierOf(v,'S'),'sem_prioridade'); assert.equal(tierOf(v,'L'),'sem_prioridade');
  assert.match(get(v,'S').reason,/sem sinal/i); assert.equal(v.tiers.insuficiente.total,0);
  const u=buildDecisionCenter(mk([row('S',10,10),row('L',1,2)],{dqPrevious:dq('SHOPEE','2026-11-10','2026-11-16',false)}));
  assert.equal(u.tiers.sem_prioridade.total,0); assert.equal(u.tiers.insuficiente.total,2,'sem cobertura é dado insuficiente, não ausência de prioridade');
});

test('situação é o último estado cadastrado, com data; só ativo entra em alta; sem situação conhecida = dados insuficientes',()=>{
  const v=buildDecisionCenter(mk([row('P',2,20,{status:'PAUSED'}),row('U',2,20,{registered:false,status:null,status_checked_at:null,listing_id:null,title:null}),
    row('M',2,20,{ambiguous_status:true,status:null,status_checked_at:null,title:null})]));
  assert.equal(tierOf(v,'P'),'revisao','não ativo nunca é alta'); const p=get(v,'P');
  assert.equal(p.status.label,'Último estado cadastrado'); assert.equal(p.status.value,'PAUSED'); assert.equal(p.status.checked_at,'2026-11-17T11:17:46.521006+00:00');
  assert.ok(p.facts.some(f=>/Último estado cadastrado: PAUSED.*verificado em 2026-11-17/.test(f)),p.facts.join('|'));
  assert.ok(!p.facts.concat(p.reason).some(t=>/confirmad[oa] em tempo real|está (ativo|pausado)/i.test(t)));
  assert.equal(tierOf(v,'U'),'insuficiente'); assert.deepEqual(get(v,'U').missing,['SITUACAO_CADASTRADA']);
  assert.equal(tierOf(v,'M'),'insuficiente'); assert.match(get(v,'M').reason,/ambígu/i);
  assert.equal(v.summary.units.current,6,'as unidades dessas vendas continuam contadas');
});

test('identidade conta + ID: linha repetida na resposta é ambígua e não distribui vendas',()=>{
  const v=buildDecisionCenter(mk([row('A',10,20),row('A',5,5)]));
  assert.equal(tierOf(v,'A'),'insuficiente'); assert.equal(v.tiers.insuficiente.rows.filter(r=>r.external_id==='A').length,1,'uma linha só, marcada ambígua');
  assert.match(get(v,'A').reason,/ambígu/i);
  assert.equal(get(v,'A').key,'SHOPEE:A');
});

test('hipótese de conversão baixa é separada das oportunidades comprovadas; relatório antigo, pouco volume ou ambíguo não gera hipótese',()=>{
  const rep={latest:{start:'2026-11-16',end:'2026-11-22',imported_at:'2026-11-23T10:00:00+00:00',store_visits:2000,store_orders:100},previous:null};
  const perf=(vis,ord,o={})=>({latest:{ambiguous_rows:false,impressions:5000,clicks:300,visits:vis,orders:ord,...o},previous:null});
  const v=buildDecisionCenter(mk([row('H',10,10,{perf:perf(300,3)}),row('OK',10,10,{perf:perf(300,15)}),row('LOW',10,10,{perf:perf(80,0)}),
    row('AMB',10,10,{perf:perf(null,null,{ambiguous_rows:true})}),row('G',20,10)],{units:{reports:rep}}));
  assert.equal(tierOf(v,'H'),'hipotese_conversao'); assert.equal(v.tiers.oportunidade.rows.some(r=>r.external_id==='H'),false);
  const h=get(v,'H'); assert.equal(h.hypotheses[0].kind,'CONVERSAO_BAIXA'); assert.match(h.hypotheses[0].text,/pode indicar/); assert.deepEqual(h.hypotheses[0].period,{start:'2026-11-16',end:'2026-11-22'});
  assert.equal(h.hypotheses[0].projected_units,undefined,'nenhuma projeção de vendas');
  assert.equal(tierOf(v,'OK'),'sem_prioridade'); assert.equal(tierOf(v,'LOW'),'sem_prioridade'); assert.equal(tierOf(v,'AMB'),'sem_prioridade');
  assert.equal(tierOf(v,'G'),'oportunidade');
  const stale=buildDecisionCenter(mk([row('H',10,10,{perf:perf(300,3)})],{units:{reports:{latest:{...rep.latest,start:'2026-10-20',end:'2026-10-27'},previous:null}}}));
  assert.equal(tierOf(stale,'H'),'sem_prioridade'); assert.equal(stale.tiers.hipotese_conversao.total,0);
  assert.ok(stale.evidence.latest.stale); assert.match(stale.evidence.latest.text,/27\/10|2026-10-27/);
});

test('hipótese de queda: só com dois relatórios comparáveis, da mesma conta, recentes e com volume mínimo',()=>{
  const rep=reports(['2026-11-16','2026-11-22'],['2026-11-09','2026-11-15']);
  const p=(imp,vis)=>perfOf(7,{imp,clk:50,vis,ord:5});
  const v=buildDecisionCenter(mk([row('A',10,30,{perf:{latest:p(1300,200),previous:p(2000,210)}}),row('B',10,30,{perf:{latest:p(900,200),previous:p(1400,210)}})],{units:{reports:rep}}));
  const a=get(v,'A'); assert.ok(a.hypotheses.some(h=>h.kind==='VISIBILIDADE_MENOR'&&/pode indicar/.test(h.text)&&h.change_pct===-35),JSON.stringify(a.hypotheses));
  assert.ok(!get(v,'B').hypotheses.some(h=>h.kind==='VISIBILIDADE_MENOR'),'volume de impressões abaixo do mínimo (1.000) no relatório mais recente');
  const overlap=buildDecisionCenter(mk([row('A',10,30,{perf:{latest:p(1300,200),previous:p(2000,210)}})],{units:{reports:reports(['2026-11-16','2026-11-22'],['2026-11-01','2026-11-17'])}}));
  assert.ok(!get(overlap,'A').hypotheses.some(h=>h.kind==='VISIBILIDADE_MENOR'),'relatórios que se sobrepõem não são comparáveis');
});

test('indisponível e investigação: estoque e preço nunca afirmados; sem valores',()=>{
  const v=buildDecisionCenter(mk([row('A',10,30)]));
  const a=get(v,'A');
  assert.ok(a.unavailable.some(u=>u.item==='ESTOQUE'&&/indispon/i.test(u.text))); assert.ok(a.unavailable.some(u=>u.item==='PRECO'&&/indispon/i.test(u.text)));
  assert.ok(a.unavailable.some(u=>u.item==='TRAFEGO'));
  assert.ok(a.investigation.length>=2); assert.ok(a.investigation.every(t=>/^(Conferir|Verificar|Comparar)/.test(t)),a.investigation.join('|'));
  const all=JSON.stringify(v);
  assert.ok(!/estoque (baixo|zerado|acabou)|sem estoque|pre[çc]o (alto|baixo|errado)|reduzir o pre|aumentar o pre|alterar o pre/i.test(all));
  assert.ok(!/"price"|"preco"|"valor_/.test(all));
});

test('totais e classificações são calculados antes de limitar as listas',()=>{
  const rows=Array.from({length:60},(_,i)=>row('A'+i,10,30+i));
  const v=buildDecisionCenter(mk(rows));
  assert.equal(TIER_LIMIT,50); assert.equal(v.tiers.alta.total,60); assert.equal(v.tiers.alta.shown,50); assert.equal(v.tiers.alta.truncated,true); assert.equal(v.tiers.alta.rows.length,50);
  assert.equal(v.summary.counts.alta,60,'o resumo usa o total, não o que foi exibido');
  assert.deepEqual(v.tiers.alta.rows.slice(0,2).map(r=>r.external_id),['A59','A58'],'maior perda primeiro');
  assert.match(v.tiers.alta.limit_note,/50 de 60/);
});

test('ordenação por unidades, nunca por valor; empate estável',()=>{
  const v=buildDecisionCenter(mk([row('B',5,15),row('A',5,15),row('C',0,40)]));
  assert.deepEqual(v.tiers.alta.rows.map(r=>r.external_id),['C','A','B']);
});

test('conciliação: soma por anúncio contra o Dashboard e a divisão por SKU da Shopee; sem vínculo não é distribuído',()=>{
  const rows=[row('A',10,20),row('B',5,5)];
  const split={current:splitOf('2026-11-17','2026-11-23',{total:20,linked:15}),previous:splitOf('2026-11-10','2026-11-16',{total:30,linked:25})};
  const ok=buildDecisionCenter(mk(rows,{split}));
  assert.equal(ok.reconciliation.dashboard.status,'CONCILIADO'); assert.equal(ok.reconciliation.shopee.unlinked,5); assert.equal(ok.reconciliation.shopee.status,'EXPLICADA');
  assert.equal(ok.reconciliation.shopee.listing_sum,15); assert.match(ok.reconciliation.shopee.note,/sem vínculo/i); assert.match(ok.reconciliation.shopee.note,/não .*distribu/i);
  assert.equal(ok.summary.units.current,15,'a soma dos anúncios não inclui a venda sem vínculo');
  const bad=buildDecisionCenter(mk(rows,{split,dash:{...mk(rows).dash,totals:{cur_units:99,prev_units:25}}}));
  assert.equal(bad.reconciliation.dashboard.status,'DIVERGENTE'); assert.ok(bad.notices.some(n=>n.kind==='UNIDADES_DIVERGENTES'&&n.essential));
  const badSplit=buildDecisionCenter(mk(rows,{split:{...split,current:splitOf('2026-11-17','2026-11-23',{total:20,linked:15,base:40})}}));
  assert.equal(badSplit.reconciliation.shopee.status,'DIVERGENTE');
});

test('resposta inválida ou truncada não classifica nada (falha fechada)',()=>{
  const wrongPlat=buildDecisionCenter(mk([row('A',10,30)],{units:{platform:'ML_NOVO'}}));
  assert.equal(wrongPlat.parts.units,'RESPOSTA_INVALIDA'); assert.equal(Object.values(wrongPlat.tiers).reduce((a,t)=>a+t.total,0),0);
  const wrongDates=buildDecisionCenter(mk([row('A',10,30)],{units:{current:{start:'2026-11-18',end:'2026-11-23'}}}));
  assert.equal(wrongDates.parts.units,'RESPOSTA_INVALIDA');
  const trunc=buildDecisionCenter(mk([row('A',10,30)],{units:{truncated:true}}));
  assert.equal(trunc.parts.units,'RESPOSTA_INVALIDA');
  const failed=buildDecisionCenter({...mk([row('A',10,30)]),units:null,failed:['units']});
  assert.equal(failed.parts.units,'INDISPONIVEL'); assert.equal(failed.status,'INDISPONIVEL');
  const noDash=buildDecisionCenter({...mk([row('A',10,30)]),dash:null,periods:null});
  assert.equal(noDash.status,'SEM_INFORMACAO');
  assert.ok(wrongPlat.notices.some(n=>n.essential));
});

test('somente leitura e sem indicadores financeiros em qualquer nível da resposta',()=>{
  const v=buildDecisionCenter(mk([row('A',10,30),row('G',20,10)]));
  const walk=(o,path='')=>{if(Array.isArray(o))o.forEach((x,i)=>walk(x,path+'['+i+']'));else if(o&&typeof o==='object')for(const [k,x] of Object.entries(o)){assert.ok(!FORBIDDEN_KEY_RE.test(k),'campo financeiro: '+path+'.'+k);walk(x,path+'.'+k);}};
  walk(v); assert.equal(v.read_only,true); assert.ok(!/receita|faturamento|lucro|margem|ticket/i.test(JSON.stringify(v)));
  assert.ok(!Object.keys(v).some(k=>/action|apply|execute|update/i.test(k)));
});

test('fontes e idade das evidências aparecem datadas; ML sem relatório é indisponível com motivo',()=>{
  const v=buildDecisionCenter({...mk([row('A',10,30)]),platform:'ML_ANTIGO',dash:dash({platform:'ML_ANTIGO'}),dqCurrent:dq('ML_ANTIGO','2026-11-17','2026-11-23'),
    dqPrevious:dq('ML_ANTIGO','2026-11-10','2026-11-16'),units:units([row('A',10,30)],{platform:'ML_ANTIGO'})});
  assert.equal(v.platform,'ML_ANTIGO'); assert.equal(v.evidence.latest.available,false); assert.match(v.evidence.latest.text,/nenhum relatório/i);
  assert.ok(get(v,'A').unavailable.find(u=>u.item==='TRAFEGO').text.match(/nenhum relatório/i));
  assert.ok(v.sources.some(s=>s.name==='VENDAS'&&s.until==='2026-11-23'));
});
