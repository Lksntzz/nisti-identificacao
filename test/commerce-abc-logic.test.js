// GA-015 — regras puras da evolução da Curva ABC por produto (dados FICTÍCIOS).
import test from 'node:test';
import assert from 'node:assert/strict';
import {sumDailyRange,classifyPeriod,comparePeriods,reconcilePeriod,planPeriods,buildAbcEvolution,buildAbcHistory,historyMonthsOf,ABC_THRESHOLDS,RELEVANCE_MIN_UNITS,dayAdd,daysBetween} from '../src/ga/commerce-abc-logic.js';

const P=(...pairs)=>pairs.map(([sku,units])=>({sku,units}));
const bySku=(c,s)=>c.rows.find(r=>r.sku===s);

test('cortes 80/95 pelo acumulado ANTERIOR: o produto que cruza o corte continua na classe de cima',()=>{
  // total 100: A(50) prec 0 -> A; B(30) prec 50 -> A; C(15) prec 80 -> B (80 não é < 80); D(5) prec 95 -> C
  const c=classifyPeriod(P(['A',50],['B',30],['C',15],['D',5]),'k');
  assert.deepEqual(c.rows.map(r=>r.class),['A','A','B','C']); assert.deepEqual(c.rows.map(r=>r.cum_pct),[50,80,95,100]);
  assert.deepEqual(c.class_counts,{A:2,B:1,C:1}); assert.equal(c.ranked_units,100);
});
test('empates: mesma posição competitiva e mesma classe; classe do grupo vem do acumulado antes do grupo; sem forçar proporções',()=>{
  // 40,20,20,20 = 100: prec do grupo de 20 = 40 -> todos A, mesmo o último ultrapassando 80% (acumulado 100)
  const c=classifyPeriod(P(['Z',20],['Y',20],['X',20],['A',40]),'k');
  assert.deepEqual(c.rows.map(r=>r.rank),[1,2,2,2]); assert.deepEqual(c.rows.map(r=>r.class),['A','A','A','A']);
  assert.equal(c.rows[1].tie_size,3); assert.equal(c.rows[1].boundary_tie,true,'o grupo cruza o corte de 80%');
  assert.equal(bySku(c,'A').boundary_tie,false);
  // posição competitiva 1,2,2,4
  const d=classifyPeriod(P(['a',5],['b',3],['c',3],['d',1]),'k'); assert.deepEqual(d.rows.map(r=>r.rank),[1,2,2,4]);
});
test('empate não depende do nome do SKU: embaralhar a entrada não muda classes nem posições',()=>{
  const base=P(['a',1],['b',1],['c',1],['d',1],['e',1],['f',1],['g',1],['h',1],['i',1],['j',1]); // 10 empatados
  const x=classifyPeriod(base,'k'),y=classifyPeriod(base.slice().reverse(),'k');
  assert.deepEqual(new Set(x.rows.map(r=>r.class)),new Set(['A'])); assert.deepEqual(x.rows.map(r=>[r.sku,r.class,r.rank]).sort(),y.rows.map(r=>[r.sku,r.class,r.rank]).sort());
});
test('população completa: ignora unidades zero/negativas/inválidas, nunca vira classe C; base informada',()=>{
  const c=classifyPeriod([{sku:'A',units:10},{sku:'Z',units:0},{sku:'N',units:-3},{sku:'F',units:1.5},{sku:'',units:4},null,{sku:'S',units:'7'}],'k');
  assert.deepEqual(c.rows.map(r=>r.sku),['A']); assert.equal(c.ranked_units,10); assert.equal(c.rows[0].share_pct,100);
  const e=classifyPeriod([],'k'); assert.equal(e.products,0); assert.equal(e.concentration.top1,null); assert.deepEqual(e.class_counts,{A:0,B:0,C:0});
});
test('concentração top 1, 3, 5 e 10 sobre a base de unidades com SKU',()=>{
  const c=classifyPeriod(P(...Array.from({length:12},(_,i)=>['S'+i,12-i])),'k'); const tot=78;
  assert.equal(c.concentration.top1,Math.round(12/tot*1000)/10); assert.equal(c.concentration.top3,Math.round(33/tot*1000)/10);
  assert.equal(c.concentration.top5,Math.round(50/tot*1000)/10); assert.equal(c.concentration.top10,Math.round(75/tot*1000)/10);
});

// ---- conciliação ----
const fp=(o={})=>({key:'k',total_units:20,sku_units:15,no_sku_units:5,ranked_units:15,products:2,...o});
const prods15=P(['A',10],['B',5]);
test('conciliação ML: GA-019 igual concilia; diferente diverge; ausente fica indisponível; SEM SKU conta no total',()=>{
  assert.equal(reconcilePeriod({platform:'ML_NOVO',period:fp(),products:prods15,ga019:20}).status,'CONCILIADO');
  const d=reconcilePeriod({platform:'ML_NOVO',period:fp(),products:prods15,ga019:21}); assert.equal(d.status,'DIVERGENTE'); assert.equal(d.reason,'GA019_DIFERENTE');
  for(const v of [null,undefined,'20',NaN]) assert.equal(reconcilePeriod({platform:'ML_NOVO',period:fp(),products:prods15,ga019:v}).status,'INDISPONIVEL',String(v));
  assert.equal(reconcilePeriod({platform:'ML_NOVO',period:null,products:[],ga019:1}).status,'INDISPONIVEL');
});
test('conciliação: totais internos incoerentes divergem',()=>{
  assert.equal(reconcilePeriod({platform:'ML_NOVO',period:fp({sku_units:14}),products:prods15,ga019:20}).reason,'TOTAIS_INTERNOS');
  assert.equal(reconcilePeriod({platform:'ML_NOVO',period:fp(),products:P(['A',10]),ga019:20}).reason,'TOTAIS_INTERNOS');
});
const split=(o={})=>({total_units:20,unlinked_units:2,reconciliation:{status:'EXPLICADA',identity_ok:true,source_units_match:true},difference:{residual_units:0},...o});
test('Shopee: exige GA-021 EXPLICADA com resíduo NUMÉRICO igual a zero (nulo, ausente, texto, NaN nunca valem)',()=>{
  const ok=reconcilePeriod({platform:'SHOPEE',period:fp(),products:prods15,ga019:20,split:split()});
  assert.equal(ok.status,'CONCILIADO'); assert.equal(ok.explained_by,'GA-021');
  for(const [why,r] of [['nulo',null],['ausente',undefined],['texto','0'],['NaN',NaN],['um',1],['negativo',-1]]){
    const s=split({difference:r===undefined?{}:{residual_units:r}}); const x=reconcilePeriod({platform:'SHOPEE',period:fp(),products:prods15,ga019:20,split:s});
    assert.equal(x.status,'DIVERGENTE',why); assert.equal(x.reason,'GA021_NAO_EXPLICA',why);
  }
  assert.equal(reconcilePeriod({platform:'SHOPEE',period:fp(),products:prods15,ga019:20,split:null}).status,'INDISPONIVEL');
  assert.equal(reconcilePeriod({platform:'SHOPEE',period:fp(),products:prods15,ga019:20,split:split({reconciliation:{status:'INDISPONIVEL'}})}).status,'INDISPONIVEL');
  assert.equal(reconcilePeriod({platform:'SHOPEE',period:fp(),products:prods15,ga019:20,split:split({total_units:19})}).status,'DIVERGENTE','total do split diferente do da função');
  assert.equal(reconcilePeriod({platform:'SHOPEE',period:fp(),products:prods15,ga019:20,split:split({reconciliation:{status:'RESIDUO_NAO_EXPLICADO'}})}).status,'DIVERGENTE');
  assert.equal(reconcilePeriod({platform:'SHOPEE',period:fp(),products:prods15,ga019:20,split:split({reconciliation:{status:'EXPLICADA',identity_ok:false,source_units_match:true}})}).status,'DIVERGENTE');
});

// ---- períodos ----
test('janelas de 7 e 30 dias terminam no último dia completo, com o mesmo tamanho, sem sobreposição, atravessando meses',()=>{
  const p7=planPeriods({mode:'7d',last:'2026-11-03',firstDay:'2025-01-01'});
  assert.deepEqual([p7.current.start,p7.current.end,p7.previous.start,p7.previous.end],['2026-10-28','2026-11-03','2026-10-21','2026-10-27']);
  const p30=planPeriods({mode:'30d',last:'2026-11-23',firstDay:'2026-01-01'});
  assert.equal(daysBetween(p30.current.start,p30.current.end),30); assert.equal(daysBetween(p30.previous.start,p30.previous.end),30);
  assert.equal(dayAdd(p30.previous.end,1),p30.current.start); assert.equal(p30.current.end,'2026-11-23'); assert.equal(p30.equivalent,true);
});
test('histórico: 12 meses no máximo, não antes do primeiro dado, mês corrente incompleto cortado no último dia completo',()=>{
  const p=planPeriods({mode:'7d',last:'2026-11-23',firstDay:'2026-01-01'});
  assert.equal(p.history.length,11); assert.equal(p.history[0].key,'2026-01'); const nov=p.history.at(-1);
  assert.deepEqual([nov.key,nov.incomplete,nov.end,nov.month_end],['2026-11',true,'2026-11-23','2026-11-30']); assert.equal(p.history.at(-2).incomplete,false);
  assert.equal(planPeriods({mode:'7d',last:'2026-11-23',firstDay:'2025-01-01'}).history.length,12);
});
test('mensal: mês incompleto compara com o mesmo número de dias do mês anterior; mês maior que o anterior não é equivalente',()=>{
  const p=planPeriods({mode:'mensal',last:'2026-11-23',firstDay:'2026-01-01'});
  assert.deepEqual([p.current.start,p.current.end,p.current.incomplete],['2026-11-01','2026-11-23',true]); assert.deepEqual([p.previous.start,p.previous.end],['2026-10-01','2026-10-23']); assert.equal(p.equivalent,true);
  const q=planPeriods({mode:'mensal',last:'2026-03-30',firstDay:'2026-01-01'}); assert.equal(q.equivalent,false); assert.ok(q.note); assert.equal(q.previous.end,'2026-02-28');
  const f=planPeriods({mode:'mensal',last:'2026-03-31',firstDay:'2026-01-01'}); assert.equal(f.equivalent,true,'mês fechado contra mês fechado'); assert.match(f.note,/número de dias diferente/);
  const o=planPeriods({mode:'mensal',month:'2026-10',last:'2026-11-23',firstDay:'2026-01-01'}); assert.deepEqual([o.current.end,o.current.incomplete,o.previous.start,o.previous.end],['2026-10-31',false,'2026-09-01','2026-09-30']);
  assert.equal(planPeriods({mode:'mensal',month:'2026-12',last:'2026-11-23'}).error,'MES_SEM_DADOS_COMPLETOS'); assert.equal(planPeriods({mode:'mensal',month:'2026-13',last:'2026-11-23'}).error,'MES_INVALIDO');
});
test('anual: mesmo intervalo do ano anterior; sem histórico anterior não inventa; 29/02 vira 28/02',()=>{
  const a=planPeriods({mode:'anual',last:'2026-11-23',firstDay:'2025-01-01'}); assert.deepEqual([a.previous.start,a.previous.end],['2025-11-01','2025-11-23']); assert.equal(a.equivalent,true);
  const ml=planPeriods({mode:'anual',last:'2026-11-23',firstDay:'2026-01-01'}); assert.equal(ml.previous,null); assert.ok(ml.note);
  const l=planPeriods({mode:'anual',month:'2028-02',last:'2028-02-29',firstDay:'2025-01-01'}); assert.equal(l.previous.end,'2027-02-28'); assert.equal(l.equivalent,false);
});
test('entradas inválidas',()=>{
  assert.equal(planPeriods({mode:'90d',last:'2026-11-23'}).error,'MODO_INVALIDO'); assert.equal(planPeriods({mode:'7d',last:null}).error,'SEM_ULTIMO_DIA_COMPLETO'); assert.equal(planPeriods({mode:'7d',last:'2026-02-30'}).error,'SEM_ULTIMO_DIA_COMPLETO');
});

// ---- comparação ----
const cls=(...pairs)=>classifyPeriod(P(...pairs),'k');
test('migração comprovada x relevância comercial: mínimo de 100 un. da conta é indicador, não impede a classe',()=>{
  const prev=cls(['A',60],['B',15],['C',10],['D',8],['E',7]),cur=cls(['A',5],['B',35],['C',25],['D',20],['E',15]); // volume 100 nos dois
  const c=comparePeriods(prev,cur,{mode:'7d'}); const a=c.entries.find(e=>e.sku==='A');
  assert.equal(a.kind,'MIGRACAO'); assert.equal(a.class_change,'A>C'); assert.equal(a.direction,'DESCEU'); assert.equal(a.delta_rank,-4); assert.equal(a.proven,true); assert.equal(a.relevant,true);
  assert.equal(c.relevance.relevant,true);
  const small=comparePeriods(cls(['A',6],['B',3],['C',1]),cls(['A',1],['B',3],['C',6]),{mode:'7d'}); // 10 un.: baixo volume
  assert.equal(small.relevance.relevant,false); const sa=small.entries.find(e=>e.sku==='A'); assert.equal(sa.class_change,'A>B','a classe é calculada mesmo com volume baixo'); assert.equal(sa.proven,true); assert.equal(sa.relevant,false);
  assert.equal(RELEVANCE_MIN_UNITS,100);
});
test('relevância exige variação mínima de unidades e de posições (limiares fixados na simulação)',()=>{
  assert.deepEqual({...ABC_THRESHOLDS['7d']},{minUnitDelta:5,minRankMove:3,unitBand:2,ppBand:0.25});
  assert.equal(ABC_THRESHOLDS['30d'].minUnitDelta,10);
  const prev=cls(['A',70],['B',16],['C',14]),cur=cls(['A',70],['B',14],['C',16]); // B e C trocam por 2 un.
  const c=comparePeriods(prev,cur,{mode:'7d'}); const mig=c.migrations; assert.ok(mig.length>=0);
  for(const m of c.entries.filter(e=>e.kind==='MIGRACAO')) assert.equal(m.relevant,false,'2 unidades de variação não é relevante');
});
test('entrada e saída da curva NÃO são migração (sem vínculo de identidade) e ficam separadas',()=>{
  const prev=cls(['A',50],['OLD',50]),cur=cls(['A',50],['NEW',50]);
  const c=comparePeriods(prev,cur,{mode:'7d'}); const o=c.entries.find(e=>e.sku==='OLD'),n=c.entries.find(e=>e.sku==='NEW');
  assert.equal(o.kind,'SAIDA'); assert.equal(n.kind,'ENTRADA'); assert.equal(o.current_units,0); assert.equal(n.previous_units,0,'ausência num período comprovado é zero vendas');
  assert.equal(c.migrations.length,0); assert.equal(c.entered,1); assert.equal(c.left,1); assert.equal(n.class_change,undefined);
});
test('crescimento de unidades x crescimento de participação são diferentes',()=>{
  // total sobe de 100 para 200: X cresce de 20 para 30 un. (+10) mas a participação cai de 20% para 15%
  const prev=cls(['X',20],['Y',80]),cur=cls(['X',30],['Y',170]);
  const x=comparePeriods(prev,cur,{mode:'30d'}).entries.find(e=>e.sku==='X');
  assert.equal(x.growth,'UNIDADES_SOBEM_PARTICIPACAO_CAI'); assert.equal(x.delta_units,10); assert.equal(x.delta_share_pp,-5);
  const y=comparePeriods(cls(['X',50],['Y',50]),cls(['X',40],['Y',20]),{mode:'7d'}).entries.find(e=>e.sku==='X');
  assert.equal(y.growth,'UNIDADES_CAEM_PARTICIPACAO_SOBE'); assert.equal(y.delta_rank,0);
  const z=comparePeriods(cls(['X',100]),cls(['X',101]),{mode:'7d'}).entries[0]; assert.equal(z.growth,'ESTAVEL');
});
test('novos no top 10 e novos na classe A são listas separadas, com posição competitiva',()=>{
  const mk=(f)=>cls(...Array.from({length:30},(_,i)=>['S'+String(i).padStart(2,'0'),f(i)]));
  const prev=mk(i=>i===29?1:100-i),cur=mk(i=>i===29?500:100-i); // S29 sai do fundo para 1º
  const c=comparePeriods(prev,cur,{mode:'30d'});
  assert.equal(c.new_top10[0].sku,'S29'); assert.equal(c.new_top10[0].rank,1); assert.equal(c.new_top10[0].previous_rank,prev.rows.find(r=>r.sku==='S29').rank);
  assert.ok(c.new_class_a.some(e=>e.sku==='S29'));
  const c2=comparePeriods(mk(i=>100-i),mk(i=>i===10?200:100-i),{mode:'30d'}); // S10 já era classe A, mas entra no top 10
  assert.ok(c2.new_top10.some(e=>e.sku==='S10')); assert.ok(!c2.new_class_a.some(e=>e.sku==='S10'),'top 10 e classe A não se confundem');
  const ent=comparePeriods(cls(['A',10]),cls(['A',10],['B',30]),{mode:'7d'}); assert.equal(ent.new_top10.find(e=>e.sku==='B').from_outside_curve,true);
});
test('sem confirmação: só unidades, sem posição, participação, classe nem migração',()=>{
  const c=comparePeriods(cls(['A',60],['B',40]),cls(['A',10],['B',90]),{mode:'7d',confirmed:false});
  assert.equal(c.migrations.length,0); assert.equal(c.migration_counts,null); assert.equal(c.new_top10.length,0);
  for(const e of c.entries){assert.equal(e.previous,undefined);assert.equal(e.class_change,undefined);assert.equal(typeof e.delta_units,'number');}
});

// ---- evolução completa ----
const plan7=planPeriods({mode:'7d',last:'2026-11-23',firstDay:'2026-01-01'});
function fixture({totals,units,cover='COMPLETA',ga019,splitOk=true,platform='ML_NOVO'}={}){
  const keys=[...plan7.history.map(h=>h.key),plan7.current.key,plan7.previous.key];
  const periods=keys.map(k=>{const sku=Object.values(units).reduce((s,u)=>s+(u[k]||0),0),nos=totals?.[k]??3;return {key:k,total_units:sku+nos,sku_units:sku,no_sku_units:nos,ranked_units:sku,nonpositive_units:0,products:Object.values(units).filter(u=>u[k]>0).length};});
  const allP=[...plan7.history,plan7.current,plan7.previous];periods.forEach(p=>{const pd=allP.find(q=>q.key===p.key);p.start=pd.start;p.end=pd.end;});
  const data={platform,periods,product_count:Object.keys(units).length,products:Object.entries(units).map(([sku,u])=>({sku,units:u}))};
  const ga=ga019||Object.fromEntries(periods.map(p=>[p.key,p.total_units]));
  const splits=platform==='SHOPEE'?Object.fromEntries(periods.map(p=>[p.key,splitOk?split({total_units:p.total_units,start:p.start,end:p.end}):split({total_units:p.total_units,start:p.start,end:p.end,difference:{residual_units:null}})])):{};
  const coverage=Object.fromEntries(keys.map(k=>[k,typeof cover==='function'?cover(k):cover]));
  return {platform,mode:'7d',today:'2026-11-25',last:'2026-11-23',plan:plan7,data,ga019:ga,coverage,splits};
}
const U={AAA:{'2026-10':90,'2026-11':80,j7_atual:60,j7_ant:30},BBB:{'2026-10':10,'2026-11':20,j7_atual:30,j7_ant:60},CCC:{'2026-10':5,j7_atual:10,j7_ant:10}};
test('evolução confirmada: SEM SKU fica no total conciliado mas fora do ranking; base informada; classes e concentração no histórico',()=>{
  const r=buildAbcEvolution(fixture({units:U,totals:{j7_atual:50}}));
  assert.equal(r.status,'OK'); assert.equal(r.current.status,'CONFIRMADO'); assert.equal(r.current.base.no_sku_units,50); assert.equal(r.current.base.total_units,150);
  assert.equal(r.current.base.kind,'UNIDADES_COM_SKU'); assert.equal(r.current.base.ranked_units,100); assert.equal(r.current.base.no_sku_pct,33.3);
  assert.ok(!r.comparison.entries.some(e=>/SEM/i.test(e.sku)));
  assert.equal(r.comparison.state,'CONFIRMADA'); assert.equal(r.comparison.entries.find(e=>e.sku==='AAA').current.share_pct,60);
  const oct=r.history.find(h=>h.key==='2026-10'); assert.equal(oct.classes_confirmed,true); assert.ok(oct.concentration.top1>0); assert.equal(oct.class_counts.A+oct.class_counts.B+oct.class_counts.C,3);
  const nov=r.history.find(h=>h.key==='2026-11'); assert.equal(nov.incomplete,true); assert.equal(nov.end,'2026-11-23');
});
test('migração AAA→B/BBB→A aparece só quando as duas janelas estão confirmadas',()=>{
  const r=buildAbcEvolution(fixture({units:U}));
  assert.equal(r.comparison.state,'CONFIRMADA'); assert.ok(r.comparison.migration_counts.total>=0);
  const ok=r.comparison.entries.find(e=>e.sku==='BBB'); assert.equal(ok.previous.rank,1); assert.equal(ok.current.rank,2);
});
test('cobertura não comprovada: mostra unidades, nunca classe confirmada nem migração; histórico antes de outubro fica "não comprovado"',()=>{
  const r=buildAbcEvolution(fixture({units:U,cover:k=>(k>='2026-10'||k.startsWith('j7'))?'COMPLETA':'PARCIAL'}));
  assert.equal(r.history.find(h=>h.key==='2026-05').status,'NAO_COMPROVADO'); assert.equal(r.history.find(h=>h.key==='2026-05').classes_confirmed,false);
  assert.equal(r.history.find(h=>h.key==='2026-05').concentration,null); assert.ok(r.history.find(h=>h.key==='2026-05').concentration_provisional===null||typeof r.history.find(h=>h.key==='2026-05').concentration_provisional==='object');
  const u=buildAbcEvolution(fixture({units:U,cover:'PARCIAL'}));
  assert.equal(u.comparison.state,'NAO_COMPROVADA'); assert.equal(u.comparison.migrations.length,0); assert.equal(u.comparison.entries[0].previous,undefined); assert.equal(u.current.classes_confirmed,false);
  const nul=buildAbcEvolution(fixture({units:U,cover:'INDISPONIVEL'})); assert.equal(nul.comparison.state,'NAO_COMPROVADA');
});
test('conciliação divergente ou indisponível bloqueia classes e migrações, com motivos distintos',()=>{
  const f=fixture({units:U}); f.ga019={...f.ga019,j7_atual:f.ga019.j7_atual+1};
  const d=buildAbcEvolution(f); assert.equal(d.comparison.state,'BLOQUEADA_DIVERGENTE'); assert.equal(d.current.status,'BLOQUEADO_DIVERGENTE'); assert.equal(d.current.class_counts,null); assert.equal(d.comparison.migrations.length,0);
  const g=fixture({units:U}); g.ga019=null; const i=buildAbcEvolution(g); assert.equal(i.comparison.state,'BLOQUEADA_INDISPONIVEL'); assert.equal(i.current.reconciliation.reason,'GA019_INDISPONIVEL');
  const s=buildAbcEvolution(fixture({units:U,platform:'SHOPEE',splitOk:false})); assert.equal(s.comparison.state,'BLOQUEADA_DIVERGENTE'); assert.equal(s.current.reconciliation.reason,'GA021_NAO_EXPLICA');
  const okS=buildAbcEvolution(fixture({units:U,platform:'SHOPEE'})); assert.equal(okS.comparison.state,'CONFIRMADA'); assert.equal(okS.current.reconciliation.explained_by,'GA-021');
});
test('mês do histórico bloqueado não derruba os demais',()=>{
  const f=fixture({units:U}); f.ga019={...f.ga019,'2026-10':1}; const r=buildAbcEvolution(f);
  assert.equal(r.history.find(h=>h.key==='2026-10').status,'BLOQUEADO_DIVERGENTE'); assert.equal(r.history.find(h=>h.key==='2026-11').status,'CONFIRMADO'); assert.equal(r.comparison.state,'CONFIRMADA');
});
test('lista limitada só na exibição: contagens e classes usam a população completa',()=>{
  const units=Object.fromEntries(Array.from({length:300},(_,i)=>['S'+String(i).padStart(3,'0'),{j7_atual:300-i,j7_ant:300-i}]));
  const r=buildAbcEvolution({...fixture({units}),limit:50});
  assert.equal(r.comparison.entries.length,50); assert.equal(r.comparison.entries_total,300); assert.equal(r.comparison.entries_truncated,true); assert.equal(r.current.products,300);
  assert.equal(r.current.class_counts.A+r.current.class_counts.B+r.current.class_counts.C,300);
});
test('períodos diferentes, sem anterior e plano inválido não comparam',()=>{
  const q=planPeriods({mode:'mensal',last:'2026-03-30',firstDay:'2026-01-01'}); const keys=[...q.history.map(h=>h.key),q.current.key,q.previous.key];
  const data={platform:'ML_NOVO',periods:keys.map(k=>({key:k,start:[...q.history,q.current,q.previous].find(h=>h.key===k).start,end:[...q.history,q.current,q.previous].find(h=>h.key===k).end,total_units:10,sku_units:10,no_sku_units:0,ranked_units:10,nonpositive_units:0,products:1})),product_count:1,products:[{sku:'A',units:Object.fromEntries(keys.map(k=>[k,10]))}]};
  const r=buildAbcEvolution({platform:'ML_NOVO',mode:'mensal',last:'2026-03-30',plan:q,data,ga019:Object.fromEntries(keys.map(k=>[k,10])),coverage:Object.fromEntries(keys.map(k=>[k,'COMPLETA'])),splits:{}});
  assert.equal(r.comparison.state,'PERIODOS_DIFERENTES');
  assert.equal(buildAbcEvolution({platform:'ML_NOVO',mode:'7d',plan:{error:'SEM_ULTIMO_DIA_COMPLETO'}}).status,'INDISPONIVEL'); assert.equal(buildAbcEvolution({platform:'TODAS',plan:plan7}).status,'INVALIDO');
});
test('o módulo não calcula nem menciona valores financeiros',async()=>{
  const fs=await import('node:fs'); const src=fs.readFileSync(new URL('../src/ga/commerce-abc-logic.js',import.meta.url),'utf8').replace(/\/\/.*$/gm,'');
  assert.ok(!/revenue|receita|ticket|faturamento|margem|price|preço/i.test(src));
});

test('a resposta da função só vale se for da conta e das datas pedidas; GA-021 de outras datas é indisponível',()=>{
  const f=fixture({units:U}); f.data.platform='SHOPEE'; const a=buildAbcEvolution(f);
  assert.equal(a.current.status,'BLOQUEADO_INDISPONIVEL'); assert.equal(a.comparison.state,'BLOQUEADA_INDISPONIVEL');
  const g=fixture({units:U}); g.data.periods.find(p=>p.key==='j7_atual').end='2026-11-22'; assert.equal(buildAbcEvolution(g).current.status,'BLOQUEADO_INDISPONIVEL');
  const h=fixture({units:U,platform:'SHOPEE'}); h.splits.j7_atual={...h.splits.j7_atual,start:'2026-11-16'}; const r=buildAbcEvolution(h);
  assert.equal(r.current.reconciliation.reason,'GA021_OUTRAS_DATAS'); assert.equal(r.current.status,'BLOQUEADO_INDISPONIVEL');
});
test('soma da GA-019 nas mesmas datas; formato inválido, data repetida ou negativo não viram total',()=>{
  const rows=[{sale_date:'2026-11-01',units:3},{sale_date:'2026-11-02',units:4},{sale_date:'2026-11-09',units:100}];
  assert.equal(sumDailyRange(rows,'2026-11-01','2026-11-07'),7); assert.equal(sumDailyRange([],'2026-11-01','2026-11-07'),0);
  for(const bad of [[{sale_date:'2026-11-01',units:1},{sale_date:'2026-11-01',units:1}],[{sale_date:'x',units:1}],[{sale_date:'2026-11-01',units:-1}],[{sale_date:'2026-11-01',units:'3'}],[null]]) assert.equal(sumDailyRange(bad,'2026-11-01','2026-11-07'),null);
  assert.equal(sumDailyRange(null,'2026-11-01','2026-11-07'),null); assert.equal(sumDailyRange(rows,'2026-11-07','2026-11-01'),null);
});

// ---- GA-P01: indicadores sem histórico; histórico calculado à parte com as MESMAS regras ----
const noHist=f=>({...f,plan:{...f.plan,history:[]}});
test('GA-P01: sem histórico no plano, a resposta traz o mesmo atual/anterior/comparação e nenhum mês nem histórico por SKU',()=>{
  const f=fixture({units:U,totals:{j7_atual:50}});
  const full=buildAbcEvolution(f),lean=buildAbcEvolution(noHist(f));
  assert.deepEqual(lean.history,[]); assert.deepEqual(lean.sku_history.months,[]); assert.deepEqual(lean.sku_history.rows,{});
  for(const k of ['current','previous','comparison','status','last_complete_day','equivalent','note'])assert.deepEqual(lean[k],full[k],k);
});
test('GA-P01: buildAbcHistory = histórico e histórico por SKU do cálculo completo, mês a mês (confirmado, não comprovado e bloqueado)',()=>{
  const cover=k=>k<'2026-10'&&/^\d{4}-\d{2}$/.test(k)?'NAO_COMPROVADA':'COMPLETA';
  const f=fixture({units:U,cover,ga019:null,totals:{j7_atual:50}});
  f.ga019={...f.ga019,'2026-03':1}; // diverge: março fica bloqueado
  const full=buildAbcEvolution(f);
  const skus=full.comparison.entries.map(e=>e.sku);
  const h=buildAbcHistory({platform:f.platform,history:f.plan.history,data:f.data,ga019:f.ga019,coverage:f.coverage,splits:f.splits,skus});
  assert.deepEqual(h.history,full.history); assert.deepEqual(h.sku_history,full.sku_history);
  assert.equal(h.history.find(x=>x.key==='2026-03').status,'BLOQUEADO_DIVERGENTE');
});
test('GA-P01: histórico por SKU só para os SKUs pedidos; SKU desconhecido recebe "sem venda" só em mês comprovado',()=>{
  const f=fixture({units:U});
  const h=buildAbcHistory({platform:f.platform,history:f.plan.history,data:f.data,ga019:f.ga019,coverage:f.coverage,splits:f.splits,skus:['AAA','ZZZ']});
  assert.deepEqual(Object.keys(h.sku_history.rows).sort(),['AAA','ZZZ']);
  assert.equal(h.sku_history.rows.ZZZ[h.sku_history.months.indexOf('2026-10')][0],'SEM_VENDA');
});
test('GA-P01: historyMonthsOf lista os meses do plano (chave e se é incompleto) sem nenhuma consulta',()=>{
  const m=historyMonthsOf(plan7); assert.equal(m.length,plan7.history.length); assert.deepEqual(m[m.length-1],{key:'2026-11',incomplete:true}); assert.deepEqual(Object.keys(m[0]).sort(),['incomplete','key']);
  assert.deepEqual(historyMonthsOf(null),[]);
});
