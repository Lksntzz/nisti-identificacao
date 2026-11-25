// GA-015 — revisão técnica do Atlas (PRs #928/#929): SEM_INFORMACAO, mês incompleto, identidade, empates, histórico por SKU, nomes, lista completa.
// Dados FICTÍCIOS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPeriod,comparePeriods,planPeriods,buildAbcEvolution,reconcilePeriod,similarCode,isPartialPeriod,attachNames,displayedSkus} from '../src/ga/commerce-abc-logic.js';

const cls=(...pairs)=>classifyPeriod(pairs.map(([sku,units])=>({sku,units})),'k');
// Monta a resposta da função para um plano; units = {SKU:{chave:unidades}}.
function build({plan,mode,last,units,cover='COMPLETA',platform='ML_NOVO',ga019,coverage,extra={}}){
  const all=[...plan.history,plan.current,...(plan.previous?[plan.previous]:[])];
  const periods=all.map(pd=>{const sku=Object.values(units).reduce((a,u)=>a+(u[pd.key]||0),0);
    return {key:pd.key,start:pd.start,end:pd.end,total_units:sku,sku_units:sku,no_sku_units:0,ranked_units:sku,nonpositive_units:0,products:Object.values(units).filter(u=>u[pd.key]>0).length};});
  const data={platform,periods,product_count:Object.keys(units).length,products:Object.entries(units).map(([sku,u])=>({sku,units:u,...(extra[sku]||{})}))};
  const g=ga019||Object.fromEntries(periods.map(p=>[p.key,p.total_units]));
  const cv=coverage||Object.fromEntries(all.map(pd=>[pd.key,cover]));
  return buildAbcEvolution({platform,mode,today:'2026-12-10',last,plan,data,ga019:g,coverage:cv,splits:{}});
}
const plan7=planPeriods({mode:'7d',last:'2026-11-23',firstDay:'2026-01-01'});
const U7=(prev,cur)=>({...Object.fromEntries(Object.entries(prev).map(([k,v])=>[k,{j7_ant:v}])),...Object.fromEntries(Object.entries(cur).map(([k,v])=>[k,{...(prev[k]!=null?{j7_ant:prev[k]}:{}),j7_atual:v}]))});

// ---- 1. SEM_INFORMACAO ----
test('produto ausente em período NÃO comprovado é SEM_INFORMACAO: sem zero implícito, entrada, saída nem variação',()=>{
  const units=U7({AAA:60,BBB:40},{AAA:50,CCC:50}); // BBB só no anterior, CCC só no atual
  const cov=Object.fromEntries([...plan7.history,plan7.current,plan7.previous].map(p=>[p.key,p.key==='j7_ant'?'NAO_COMPROVADA':'COMPLETA']));
  const r=build({plan:plan7,mode:'7d',last:'2026-11-23',units,coverage:cov});
  const c=r.comparison; assert.equal(c.state,'NAO_COMPROVADA');
  const ccc=c.entries.find(e=>e.sku==='CCC'),bbb=c.entries.find(e=>e.sku==='BBB'),aaa=c.entries.find(e=>e.sku==='AAA');
  assert.equal(ccc.kind,'SEM_INFORMACAO'); assert.equal(ccc.unknown_side,'ANTERIOR'); assert.equal(ccc.previous_units,null); assert.equal(ccc.delta_units,null); assert.equal(ccc.delta_units_pct,null);
  assert.equal(bbb.kind,'SEM_INFORMACAO'); assert.equal(bbb.unknown_side,'ATUAL'); assert.equal(bbb.current_units,null);
  assert.notEqual(aaa.kind,'SEM_INFORMACAO'); assert.equal(c.entered,null); assert.equal(c.left,null); assert.equal(c.no_information,2);
  assert.equal(c.migrations.length,0); assert.equal(c.migration_counts,null); assert.equal(c.new_top10.length,0); assert.equal(c.new_class_a.length,0);
});
test('as duas pontas comprovadas: ausência é zero vendas e vira entrada/saída',()=>{
  const c=comparePeriods(cls(['AAA',50],['BBB',50]),cls(['AAA',50],['CCC',50]),{mode:'7d'});
  assert.equal(c.entries.find(e=>e.sku==='CCC').previous_units,0); assert.equal(c.entered,1); assert.equal(c.left,1); assert.equal(c.no_information,0);
});

// ---- 2. mês incompleto ----
test('mês incompleto: comparação equivalente "mês até aqui" à parte; mudança de classe nunca é migração confirmada',()=>{
  const plan=planPeriods({mode:'mensal',last:'2026-11-23',firstDay:'2026-01-01'});
  assert.equal(isPartialPeriod(plan.current),true); assert.equal(isPartialPeriod(plan.previous),true);
  const units={AAA:{m_ant:50,m_atual:10,'2026-10':50,'2026-11':10},BBB:{m_ant:10,m_atual:60,'2026-10':10,'2026-11':60},CCC:{m_ant:40,m_atual:30,'2026-10':40,'2026-11':30}};
  const r=build({plan,mode:'mensal',last:'2026-11-23',units});
  const c=r.comparison; assert.equal(c.state,'MES_ATE_AQUI'); assert.equal(c.reason,'MES_INCOMPLETO'); assert.equal(c.partial,true);
  assert.deepEqual(c.migrations,[]); assert.equal(c.migration_counts,null); assert.ok(c.partial_changes.length>=1);
  for(const m of c.partial_changes){assert.equal(m.kind,'MUDANCA_PARCIAL'); assert.equal(m.proven,false); assert.equal(m.relevant,false);}
  for(const l of [...c.new_top10,...c.new_class_a]){assert.equal(l.partial,true); assert.equal(l.relevant,false);}
  assert.equal(c.partial_counts.relevant,0);
});
test('mês fechado contra mês fechado continua comparação confirmada com migração',()=>{
  const plan=planPeriods({mode:'mensal',last:'2026-12-05',month:'2026-11',firstDay:'2026-01-01'});
  assert.equal(isPartialPeriod(plan.current),false); assert.equal(isPartialPeriod(plan.previous),false);
  const units={AAA:{m_ant:600,m_atual:100},BBB:{m_ant:100,m_atual:600},CCC:{m_ant:300,m_atual:300}};
  const r=build({plan,mode:'mensal',last:'2026-12-05',units}); assert.equal(r.comparison.state,'CONFIRMADA'); assert.ok(r.comparison.migrations.length>=1);
  assert.equal(r.comparison.migrations[0].proven,true);
});
test('7 dias e 30 dias não são meses parciais',()=>{assert.equal(isPartialPeriod(plan7.current),false); assert.equal(isPartialPeriod(plan7.previous),false);});

// ---- 3. identidade ----
test('entrada/saída com código parecido do outro lado vira IDENTIDADE_INCERTA: não afirma produto novo nem perdido',()=>{
  const c=comparePeriods(cls(['ABC123BB',50],['ZZZ',50]),cls(['ABC123BXB',50],['ZZZ',50]),{mode:'7d'});
  const a=c.entries.find(e=>e.sku==='ABC123BB'),b=c.entries.find(e=>e.sku==='ABC123BXB');
  assert.equal(a.kind,'IDENTIDADE_INCERTA'); assert.equal(a.was,'SAIDA'); assert.deepEqual(a.identity_candidates,['ABC123BXB']);
  assert.equal(b.kind,'IDENTIDADE_INCERTA'); assert.equal(b.was,'ENTRADA');
  assert.equal(c.entered,0); assert.equal(c.left,0); assert.equal(c.identity_uncertain,2); assert.equal(c.migrations.length,0);
  const nt=c.new_class_a.concat(c.new_top10).filter(x=>x.sku==='ABC123BXB'); assert.ok(nt.length>=1); for(const x of nt){assert.equal(x.identity_uncertain,true); assert.equal(x.relevant,false);}
  assert.equal(similarCode('ABC123BB','ABC123BXB'),true); assert.equal(similarCode('OLD','NEW'),false); assert.equal(similarCode('A','A'),false);
});
test('vínculo comprovado (apelido da função) chega nas linhas como linked_from',()=>{
  const plan=plan7;const units={AAA:{j7_ant:50,j7_atual:50,'2026-10':5},BBB:{j7_ant:50,j7_atual:50}};
  const r=build({plan,mode:'7d',last:'2026-11-23',units,extra:{AAA:{linked_from:['AAA-OLD']}}});
  assert.deepEqual(r.comparison.entries.find(e=>e.sku==='AAA').linked_from,['AAA-OLD']); assert.equal(r.comparison.entries.find(e=>e.sku==='BBB').linked_from,undefined);
});

// ---- 4. empates ----
test('migração afetada por empate na fronteira: classe comprovada, mas nunca relevante confirmada',()=>{
  // atual: 40,20,20,20 -> grupo de 20 cruza o corte de 80% (boundary_tie); anterior sem empate
  const prev=cls(['A',400],['B',300],['C',200],['D',100]),cur=cls(['A',400],['B',200],['C',200],['D',200]);
  const c=comparePeriods(prev,cur,{mode:'7d'}); const tied=c.entries.filter(e=>e.kind==='MIGRACAO'&&e.tie_affected);
  assert.ok(tied.length>=1,'há migração afetada por empate'); for(const m of tied){assert.equal(m.proven,true); assert.equal(m.relevant,false);}
  assert.equal(c.migration_counts.tie_affected,tied.length); assert.equal(c.migration_counts.relevant,c.migrations.filter(m=>m.relevant).length);
});
test('top 10: empatados na 10ª posição entram todos (pode haver mais de 10) e são marcados tie_at_cut, nunca relevantes',()=>{
  const top=[['T0',100],['T1',99],['T2',98],['T3',97],['T4',96],['T5',95],['T6',94],['T7',93],['T8',92]];
  const cur=cls(...top,['U1',20],['U2',20],['U3',20]); // 9 + empate de 3 na 10ª posição = 12 membros
  assert.equal(cur.top10_members,12); assert.deepEqual(cur.rows.slice(9).map(r=>r.rank),[10,10,10]);
  const prev=cls(...top,['W',1]); // anterior: só W na 10ª posição
  const c=comparePeriods(prev,cur,{mode:'7d'});
  const ties=c.new_top10.filter(n=>/^U/.test(n.sku)); assert.equal(ties.length,3);
  for(const n of ties){assert.equal(n.tie_at_cut,true); assert.equal(n.relevant,false);}
  // sem empate no corte, o novo membro pode ser relevante (conta com 100+ unidades nos dois períodos)
  const solo=comparePeriods(cls(...top,['W',1]),cls(...top,['N',60],['W',1]),{mode:'7d'}).new_top10.find(n=>n.sku==='N');
  assert.equal(solo.tie_at_cut,false); assert.equal(solo.relevant,true);
});

// ---- 5. histórico individual por SKU ----
test('histórico por SKU: estado, unidades, participação, posição e classe de cada mês; ausência comprovada = SEM_VENDA; não comprovada = SEM_INFORMACAO',()=>{
  const units={AAA:{j7_ant:50,j7_atual:50,'2026-10':80,'2026-09':80,'2026-11':60},BBB:{j7_ant:50,j7_atual:50,'2026-10':20,'2026-09':20,'2026-11':40}};
  const cov=Object.fromEntries([...plan7.history,plan7.current,plan7.previous].map(p=>[p.key,p.key<'2026-10'&&/^\d{4}-\d{2}$/.test(p.key)?'NAO_COMPROVADA':'COMPLETA']));
  units.CCC={j7_ant:1,j7_atual:1,'2026-09':5}; // CCC só em setembro (não comprovado); em outubro (comprovado) = sem venda
  const r=build({plan:plan7,mode:'7d',last:'2026-11-23',units,coverage:cov}); const sh=r.sku_history; assert.deepEqual(sh.columns,['state','units','share_pct','rank','class']);
  const idx=k=>sh.months.indexOf(k); const row=s=>sh.rows[s];
  assert.equal(sh.months.length,r.history.length); assert.deepEqual(sh.months,r.history.map(h=>h.key));
  const oct=row('AAA')[idx('2026-10')]; assert.equal(oct[0],'CLASSIFICADO'); assert.equal(oct[1],80); assert.equal(oct[2],80); assert.equal(oct[3],1); assert.equal(oct[4],'A');
  assert.equal(row('CCC')[idx('2026-10')][0],'SEM_VENDA'); assert.equal(row('CCC')[idx('2026-10')][1],0);
  assert.deepEqual(row('CCC')[idx('2026-09')],['NAO_CONFIRMADO',5,null,null,null]); assert.deepEqual(row('AAA')[idx('2026-08')],['SEM_INFORMACAO',null,null,null,null]);
  assert.equal(row('BBB')[idx('2026-11')][1],40);
});
test('histórico por SKU: mês bloqueado devolve BLOQUEADO sem unidades',()=>{
  const units={AAA:{j7_ant:50,j7_atual:50,'2026-10':80},BBB:{j7_ant:50,j7_atual:50,'2026-10':20}};
  const g=Object.fromEntries([...plan7.history,plan7.current,plan7.previous].map(p=>[p.key,null])); 
  const r=build({plan:plan7,mode:'7d',last:'2026-11-23',units,ga019:{...Object.fromEntries(Object.keys(g).map(k=>[k,100])),'2026-10':7}});
  assert.equal(r.history.find(h=>h.key==='2026-10').status,'BLOQUEADO_DIVERGENTE');
  assert.deepEqual(r.sku_history.rows.AAA[r.sku_history.months.indexOf('2026-10')],['BLOQUEADO',null,null,null,null]);
});

// ---- 8. lista completa, SKUs únicos, período não verificado ----
test('lista da função incompleta ou com SKU repetido bloqueia como divergente (LISTA_INCOMPLETA)',()=>{
  const units={AAA:{j7_ant:50,j7_atual:50},BBB:{j7_ant:50,j7_atual:50}};
  const mk=mut=>{const plan=plan7;const all=[...plan.history,plan.current,plan.previous];
    const periods=all.map(pd=>({key:pd.key,start:pd.start,end:pd.end,total_units:Object.values(units).reduce((a,u)=>a+(u[pd.key]||0),0),sku_units:Object.values(units).reduce((a,u)=>a+(u[pd.key]||0),0),no_sku_units:0,ranked_units:Object.values(units).reduce((a,u)=>a+(u[pd.key]||0),0),nonpositive_units:0,products:Object.values(units).filter(u=>u[pd.key]>0).length}));
    const data=mut({platform:'ML_NOVO',periods,product_count:2,products:Object.entries(units).map(([sku,u])=>({sku,units:u}))});
    return buildAbcEvolution({platform:'ML_NOVO',mode:'7d',last:'2026-11-23',plan,data,ga019:Object.fromEntries(periods.map(p=>[p.key,p.total_units])),coverage:Object.fromEntries(all.map(p=>[p.key,'COMPLETA'])),splits:{}});};
  assert.equal(mk(d=>d).current.status,'CONFIRMADO');
  const cut=mk(d=>({...d,product_count:3})); assert.equal(cut.current.status,'BLOQUEADO_DIVERGENTE'); assert.equal(cut.current.reconciliation.reason,'LISTA_INCOMPLETA');
  const dup=mk(d=>({...d,products:[...d.products,d.products[0]],product_count:3})); assert.equal(dup.comparison.state,'BLOQUEADA_DIVERGENTE'); assert.equal(dup.current.reconciliation.reason,'LISTA_INCOMPLETA');
  const cnt=mk(d=>({...d,periods:d.periods.map(p=>p.key==='j7_atual'?{...p,products:5}:p)})); assert.equal(cnt.current.reconciliation.reason,'TOTAIS_INTERNOS'); assert.equal(cnt.comparison.state,'BLOQUEADA_DIVERGENTE');
});
test('período não verificado nesta consulta (limite de consultas) fica indisponível, nunca confirmado',()=>{
  const r=reconcilePeriod({platform:'ML_NOVO',period:{key:'k',total_units:10,sku_units:10,no_sku_units:0,ranked_units:10,products:1},products:[{sku:'A',units:10}],ga019:10,skipped:true});
  assert.equal(r.status,'INDISPONIVEL'); assert.equal(r.reason,'NAO_VERIFICADO');
  const units={AAA:{j7_ant:50,j7_atual:50,'2026-10':80}};
  const plan=plan7;const all=[...plan.history,plan.current,plan.previous];
  const periods=all.map(pd=>({key:pd.key,start:pd.start,end:pd.end,total_units:units.AAA[pd.key]||0,sku_units:units.AAA[pd.key]||0,no_sku_units:0,ranked_units:units.AAA[pd.key]||0,nonpositive_units:0,products:units.AAA[pd.key]?1:0}));
  const o=buildAbcEvolution({platform:'ML_NOVO',mode:'7d',last:'2026-11-23',plan,data:{platform:'ML_NOVO',periods,product_count:1,products:[{sku:'AAA',units:units.AAA}]},ga019:Object.fromEntries(periods.map(p=>[p.key,p.total_units])),coverage:Object.fromEntries(all.map(p=>[p.key,'COMPLETA'])),splits:{},skipped:['2026-10']});
  assert.equal(o.history.find(h=>h.key==='2026-10').status,'BLOQUEADO_INDISPONIVEL'); assert.equal(o.current.status,'CONFIRMADO');
});

// ---- 6. nomes ----
test('nomes: só com vínculo confiável (cadastro ou venda); sem vínculo fica o código; nada é inventado',()=>{
  const plan=plan7;const units={AAA:{j7_ant:50,j7_atual:50},BBB:{j7_ant:50,j7_atual:50},CCC:{j7_ant:50,j7_atual:50}};
  const r=build({plan,mode:'7d',last:'2026-11-23',units});
  assert.deepEqual(displayedSkus(r).sort(),['AAA','BBB','CCC']);
  attachNames(r,[{sku:'AAA',name:'  Produto Fictício  ',source:'CADASTRO'},{sku:'BBB',name:'Anúncio Fictício',source:'VENDA'},{sku:'CCC',name:'Chute',source:'PALPITE'},{sku:'ZZZ',name:'Fora da lista',source:'CADASTRO'},{sku:'DDD',name:'',source:'CADASTRO'}]);
  const e=Object.fromEntries(r.comparison.entries.map(x=>[x.sku,x]));
  assert.deepEqual([e.AAA.name,e.AAA.name_source],['Produto Fictício','CADASTRO']); assert.deepEqual([e.BBB.name,e.BBB.name_source],['Anúncio Fictício','VENDA']);
  assert.equal(e.CCC.name,undefined,'origem desconhecida não vira nome'); assert.equal(r.comparison.entries.length,3);
  assert.equal(attachNames({status:'OK'},[]).status,'OK'); assert.deepEqual(displayedSkus(null),[]);
});

// ---- revisão final: duração em meses fechados e vocabulário ----
const mk8=a=>classifyPeriod(a.map((u,i)=>({sku:'S'+i,units:u})),'k');
const PREV8=[215,306,218,158,249,233,81,108],CUR8=[218,61,19,157,261,32,92,100]; // S6 relevante só pela diferença absoluta; S7 só pelo ritmo (cenário encontrado por busca determinística)
test('meses fechados de durações diferentes: classe e participação comparam; relevância usa o ritmo por dia, não a diferença absoluta',()=>{
  const P=mk8(PREV8),C=mk8(CUR8);
  const same=comparePeriods(P,C,{mode:'mensal',days:{prev:30,cur:30}}),none=comparePeriods(P,C,{mode:'mensal'});
  assert.deepEqual(same.migrations.map(m=>[m.sku,m.relevant]),none.migrations.map(m=>[m.sku,m.relevant]),'durações iguais: regra absoluta inalterada');
  assert.equal(same.duration_adjusted,false); assert.equal(none.entries.find(e=>e.sku==='S6').duration_adjusted,undefined);
  assert.equal(none.migrations.find(m=>m.sku==='S6').relevant,true); assert.equal(none.migrations.find(m=>m.sku==='S7').relevant,false);
  const d=comparePeriods(P,C,{mode:'mensal',days:{prev:28,cur:31}});
  assert.equal(d.duration_adjusted,true); assert.equal(d.reference_days,30);
  const s6=d.migrations.find(m=>m.sku==='S6'),s7=d.migrations.find(m=>m.sku==='S7');
  assert.ok(s6&&s7,'a mudança de classe continua comparável'); assert.ok(s6.previous.class&&s6.current.class&&s6.delta_share_pp!=null);
  assert.equal(s6.relevant,false,'a diferença absoluta de unidades não decide sozinha'); assert.equal(s7.relevant,true,'o ritmo por dia decide');
  assert.equal(s6.duration_adjusted,true); assert.equal(s6.delta_units,CUR8[6]-PREV8[6]); assert.equal(s6.delta_units_equiv,Math.round((CUR8[6]/31-PREV8[6]/28)*30*100)/100);
  assert.equal(d.migration_counts.relevant,d.migrations.filter(m=>m.relevant).length);
});
test('duração diferente: a leitura de crescimento em unidades também usa o ritmo (mesmo ritmo = unidades estáveis)',()=>{
  const c=comparePeriods(cls(['A',280],['B',280]),cls(['A',310],['B',310]),{mode:'mensal',days:{prev:28,cur:31}}); // 10 un/dia nas duas
  const a=c.entries.find(e=>e.sku==='A'); assert.equal(a.delta_units,30); assert.equal(a.delta_units_equiv,0); assert.equal(a.delta_units_pct,0); assert.match(a.growth,/ESTAVEL|UNIDADES_ESTAVEIS/);
  const plain=comparePeriods(cls(['A',280],['B',280]),cls(['A',310],['B',310]),{mode:'mensal'}); assert.equal(plain.entries.find(e=>e.sku==='A').delta_units_pct,10.7);
});
test('duração diferente: novo no top 10 com 10 un. num mês de 31 dias é relevante pela soma absoluta, mas não pelo ritmo (9,7 por 30 dias)',()=>{
  const base=[['T0',900],['T1',890],['T2',880],['T3',870],['T4',860],['T5',850],['T6',840],['T7',830],['T8',820]];
  const prev=cls(...base,['W',5]),cur=cls(...base,['N',10],['W',5]);
  assert.equal(comparePeriods(prev,cur,{mode:'mensal'}).new_top10.find(n=>n.sku==='N').relevant,true);
  assert.equal(comparePeriods(prev,cur,{mode:'mensal',days:{prev:28,cur:31}}).new_top10.find(n=>n.sku==='N').relevant,false);
  assert.equal(comparePeriods(prev,cur,{mode:'mensal',days:{prev:31,cur:28}}).new_top10.find(n=>n.sku==='N').relevant,true,'28 dias: 10,7 por 30 dias');
});
test('integração: meses fechados de 28 e 31 dias seguem CONFIRMADA e marcam duração ajustada',()=>{
  const plan=planPeriods({mode:'mensal',last:'2026-12-05',month:'2026-03',firstDay:'2026-01-01'});
  assert.equal(plan.equivalent,true); assert.match(plan.note,/número de dias diferente/);
  const units={AAA:{m_ant:560,m_atual:620},BBB:{m_ant:280,m_atual:310},CCC:{m_ant:56,m_atual:62}}; // mesmo ritmo por dia
  const r=build({plan,mode:'mensal',last:'2026-12-05',units}); assert.equal(r.comparison.state,'CONFIRMADA'); assert.equal(r.comparison.duration_adjusted,true);
  assert.equal(r.comparison.entries.find(e=>e.sku==='AAA').delta_units_equiv,0); assert.equal(r.comparison.migrations.length,0);
  assert.equal(r.comparison.entries.find(e=>e.sku==='AAA').current.share_pct,r.comparison.entries.find(e=>e.sku==='AAA').previous.share_pct);
});
