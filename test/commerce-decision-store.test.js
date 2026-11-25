// GA-014 — montagem no servidor com dependências injetadas e formatos reais das respostas do banco (sem rede).
import test from 'node:test';
import assert from 'node:assert/strict';
import {commerceDecisionCenterV1} from '../src/ga/commerce-supabase-store.js';
import {dq,row,units,splitOf,TODAY,confirmedTotal,tierOf} from './fixtures-decision.js';

// Cobertura por dia (GA-018 de UM dia): `days` mapeia data -> COMPLETO | PARCIAL | COM_REGISTROS | SEM_INFORMACAO. Em janelas maiores, usa o dq() padrão.
const dayDq=(platform,day,state,{lastSale='2026-11-24'}={})=>({platform,period:{start:day,end:day,today:TODAY},sales:{requested_days:1,complete_days:state==='COMPLETO'?1:0,partial_days:state==='PARCIAL'?1:0,
  days_with_records_unverified:state==='COM_REGISTROS'?1:0,days_without_information:state==='SEM_INFORMACAO'?1:0,last_sale_day:lastSale,last_import_at:'2026-11-24T13:53:39+00:00'}});
const mkUnits=(platform,w,rows)=>({...units(rows,{current:w.current,previous:w.previous}),platform});
const mk=(over={},{days:dayStates={'2026-11-24':'PARCIAL','2026-11-23':'COMPLETO'},lastSale='2026-11-24'}={})=>{
  const calls=[];
  const deps={
    today:()=>TODAY,
    units:async(_e,a)=>{calls.push(['units',a]);return mkUnits(a.platform,a,[row('A',10,20),row('B',20,0)]);},
    quality:async(_e,a)=>{calls.push(['quality',a]);
      if(a.start===a.end)return dayDq(a.platform,a.start,dayStates[a.start]||'SEM_INFORMACAO',{lastSale});
      return dq(a.platform,a.start,a.end);},
    // Fonte diária coerente com mkUnits: 30 un no último dia do período atual e 20 no último do anterior (7 dias antes).
    source:async(_e,a)=>{calls.push(['source',a]);const rows=[];const prevEnd=new Date(Date.parse(a.end)-7*86400000).toISOString().slice(0,10);
      for(let t=Date.parse(a.start);t<=Date.parse(a.end);t+=86400000){const day=new Date(t).toISOString().slice(0,10);rows.push({sale_date:day,units:day===a.end?30:day===prevEnd?20:0});}return rows;},
    split:async(_e,a)=>{calls.push(['split',a]);return splitOf(a.start,a.end,{total:a.end==='2026-11-23'?30:20,linked:a.end==='2026-11-23'?30:20});},
    ...over};
  return {deps,calls};
};

test('store: a janela termina no último dia COMPLETO (23/11), não na última importada parcial (24/11), e tudo usa as MESMAS datas',async()=>{
  const {deps,calls}=mk();
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(r.platform,'SHOPEE'); assert.equal(r.read_only,true);
  assert.deepEqual(r.window.analyzed,{current:{start:'2026-11-17',end:'2026-11-23'},previous:{start:'2026-11-10',end:'2026-11-16'}});
  assert.equal(r.window.last_import_day,'2026-11-24'); assert.equal(r.window.last_complete_day,'2026-11-23'); assert.deepEqual(r.window.skipped,[{day:'2026-11-24',state:'PARCIAL'}]);
  assert.deepEqual(calls.find(c=>c[0]==='units')[1],{platform:'SHOPEE',current:{start:'2026-11-17',end:'2026-11-23'},previous:{start:'2026-11-10',end:'2026-11-16'}});
  assert.deepEqual(calls.find(c=>c[0]==='source')[1],{platform:'SHOPEE',start:'2026-11-10',end:'2026-11-23'});
  assert.deepEqual(calls.filter(c=>c[0]==='split').map(c=>[c[1].start,c[1].end]).sort(),[['2026-11-10','2026-11-16'],['2026-11-17','2026-11-23']]);
  const windows=calls.filter(c=>c[0]==='quality'&&c[1].start!==c[1].end).map(c=>[c[1].start,c[1].end]).sort();
  assert.deepEqual(windows,[['2026-11-10','2026-11-16'],['2026-11-17','2026-11-23']]);
  for(const [n,a] of calls.filter(c=>['units','quality','source'].includes(c[0])))assert.equal(a.platform,'SHOPEE',n);
  assert.equal(calls.some(c=>c[0]==='dashboard'),false,'o Dashboard não define mais os períodos');
});
test('store: procura o último dia completo de ontem para trás, um dia por vez, e para ao achar',async()=>{
  const {deps,calls}=mk({}, {days:{'2026-11-24':'PARCIAL','2026-11-23':'PARCIAL','2026-11-22':'SEM_INFORMACAO','2026-11-21':'COMPLETO'}});
  const r=await commerceDecisionCenterV1({},{platform:'ML_NOVO',days:7},deps);
  assert.deepEqual(calls.filter(c=>c[0]==='quality'&&c[1].start===c[1].end).map(c=>c[1].start),['2026-11-24','2026-11-23','2026-11-22','2026-11-21']);
  assert.equal(r.window.last_complete_day,'2026-11-21'); assert.deepEqual(r.window.skipped.map(x=>x.state),['PARCIAL','PARCIAL','SEM_INFORMACAO']);
  assert.deepEqual(r.window.analyzed.current,{start:'2026-11-15',end:'2026-11-21'});
});
test('store: dia completo SEM vendas depois da última venda é o fim da janela (último dia com vendas não é último dia completo)',async()=>{
  const {deps}=mk({}, {days:{'2026-11-24':'COMPLETO'},lastSale:'2026-11-22'});
  const r=await commerceDecisionCenterV1({},{platform:'ML_ANTIGO',days:7},deps);
  assert.equal(r.window.last_import_day,'2026-11-22'); assert.equal(r.window.last_complete_day,'2026-11-24'); assert.equal(r.window.analyzed.current.end,'2026-11-24');
});
test('store: contas com datas de encerramento diferentes recebem janelas diferentes na mesma execução',async()=>{
  const states={SHOPEE:{'2026-11-24':'COMPLETO'},ML_ANTIGO:{'2026-11-24':'PARCIAL','2026-11-23':'COMPLETO'},ML_NOVO:{'2026-11-24':'PARCIAL','2026-11-23':'PARCIAL','2026-11-22':'COMPLETO'}};
  const ends={};
  for(const platform of Object.keys(states)){
    const {deps}=mk({quality:async(_e,a)=>a.start===a.end?dayDq(a.platform,a.start,states[a.platform][a.start]||'SEM_INFORMACAO'):dq(a.platform,a.start,a.end)});
    ends[platform]=(await commerceDecisionCenterV1({},{platform,days:7},deps)).window.analyzed.current.end;
  }
  assert.deepEqual(ends,{SHOPEE:'2026-11-24',ML_ANTIGO:'2026-11-23',ML_NOVO:'2026-11-22'});
});
test('store: sem nenhum dia completo nos últimos 14 dias, a janela termina no último dia importado e tudo fica como candidato',async()=>{
  const {deps,calls}=mk({}, {days:{'2026-11-24':'PARCIAL'}});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(calls.filter(c=>c[0]==='quality'&&c[1].start===c[1].end).length,14);
  assert.equal(r.window.basis,'SEM_DIA_COMPLETO'); assert.equal(r.window.last_complete_day,null); assert.equal(r.window.analyzed.current.end,'2026-11-24');
  assert.ok(r.notices.some(n=>n.kind==='SEM_DIA_COMPLETO')); assert.equal(confirmedTotal(r),0);
});
test('store: conta sem nenhuma venda importada não é procurada 14 vezes e vira SEM_INFORMACAO',async()=>{
  const {deps,calls}=mk({quality:async(_e,a)=>{calls.push(['quality',a]);return {...dayDq(a.platform,a.start,'SEM_INFORMACAO'),sales:{requested_days:1,complete_days:0,partial_days:0,days_with_records_unverified:0,days_without_information:1,last_sale_day:null}};}});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(calls.length,1); assert.equal(r.status,'SEM_INFORMACAO'); assert.equal(calls.some(c=>c[0]==='units'),false);
});
test('store: GA-018 falhando ou respondendo de outra conta ao procurar o dia completo não classifica nada',async()=>{
  for(const [why,quality] of [['falha',async()=>{throw new Error('segredo-interno');}],['outra conta',async(_e,a)=>dayDq('ML_NOVO',a.start,'COMPLETO')],['sem contagem',async()=>({platform:'SHOPEE',sales:{}})]]){
    const {deps,calls}=mk({quality});
    const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
    assert.equal(r.status,'INDISPONIVEL',why); assert.equal(confirmedTotal(r),0,why); assert.equal(calls.some(c=>c[0]==='units'),false,why);
    assert.doesNotMatch(JSON.stringify(r),/segredo-interno/,why);
  }
});
test('store: ML não pede a divisão por vínculo (só Shopee)',async()=>{
  const {deps,calls}=mk();
  await commerceDecisionCenterV1({},{platform:'ML_NOVO',days:7},deps);
  assert.equal(calls.some(c=>c[0]==='split'),false);
});
test('store: filtros inválidos são recusados antes de qualquer consulta',async()=>{
  const {deps,calls}=mk();
  for(const f of [{platform:'TODAS',days:7},{platform:'SHOPEE',days:60},{platform:'x',days:7},{platform:'SHOPEE',days:'7; drop'}])
    await assert.rejects(()=>commerceDecisionCenterV1({},f,deps));
  assert.equal(calls.length,0);
});
test('store: função de unidades indisponível vira INDISPONIVEL, sem vazar o erro',async()=>{
  const {deps}=mk({units:async()=>{throw new Error('segredo-interno');}});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(r.status,'INDISPONIVEL'); assert.equal(r.parts.units,'INDISPONIVEL'); assert.equal(r.tiers.alta.total,0);
  assert.doesNotMatch(JSON.stringify(r),/segredo-interno/);
});
test('store: fonte diária GA-019 indisponível ou inválida bloqueia as classificações confirmadas (indisponível, não divergente)',async()=>{
  for(const [why,source] of [['falha',async()=>{throw new Error('x');}],['formato',async()=>[{sale_date:'17/11',units:1}]],['não é lista',async()=>({})]]){
    const {deps}=mk({source});
    const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
    assert.equal(r.blocked_confirmations,true,why); assert.equal(r.reconciliation.blocked_kind,'INDISPONIVEL',why); assert.equal(confirmedTotal(r),0,why);
  }
});
test('store: soma da fonte diária diferente da função do banco bloqueia como DIVERGENTE',async()=>{
  const {deps}=mk({source:async(_e,a)=>{const rows=[];for(let t=Date.parse(a.start);t<=Date.parse(a.end);t+=86400000)rows.push({sale_date:new Date(t).toISOString().slice(0,10),units:1});return rows;}});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(r.reconciliation.blocked_kind,'DIVERGENTE'); assert.equal(confirmedTotal(r),0);
});
test('store: divisão por SKU da Shopee indisponível em um período bloqueia como indisponível',async()=>{
  const {deps}=mk({split:async(_e,a)=>{if(a.end==='2026-11-16')throw new Error('x');return splitOf(a.start,a.end,{total:30,linked:30});}});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(r.reconciliation.blocked_kind,'INDISPONIVEL'); assert.equal(r.parts.split,'INDISPONIVEL'); assert.equal(confirmedTotal(r),0);
});
test('store: o resultado é só leitura, e a fonte diária devolve só unidades (sem receita)',async()=>{
  const {deps}=mk({source:async(_e,a)=>{const rows=[];for(let t=Date.parse(a.start);t<=Date.parse(a.end);t+=86400000)rows.push({sale_date:new Date(t).toISOString().slice(0,10),units:0,revenue:999});rows[rows.length-1].units=20;return rows;}});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(r.read_only,true); assert.doesNotMatch(JSON.stringify(r),/revenue|999/);
});

test('store: as datas devolvidas pela GA-018 na busca do último dia completo são conferidas (início, fim e hoje)',async()=>{
  const bad={'início diferente':a=>({...dayDq(a.platform,a.start,'COMPLETO'),period:{start:'2026-11-01',end:a.end,today:TODAY}}),
    'fim diferente':a=>({...dayDq(a.platform,a.start,'COMPLETO'),period:{start:a.start,end:'2026-11-30',today:TODAY}}),
    'período de vários dias':a=>({...dayDq(a.platform,a.start,'COMPLETO'),period:{start:'2026-11-17',end:a.end,today:TODAY}}),
    'hoje diferente':a=>({...dayDq(a.platform,a.start,'COMPLETO'),period:{start:a.start,end:a.end,today:'2026-11-26'}}),
    'hoje ausente':a=>({...dayDq(a.platform,a.start,'COMPLETO'),period:{start:a.start,end:a.end}}),
    'período ausente':a=>{const q=dayDq(a.platform,a.start,'COMPLETO');delete q.period;return q;},
    'data inválida':a=>({...dayDq(a.platform,a.start,'COMPLETO'),period:{start:'2026-13-45',end:'2026-13-45',today:TODAY}})};
  for(const [why,make] of Object.entries(bad)){
    const {deps,calls}=mk({quality:async(_e,a)=>make(a)});
    const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
    assert.equal(r.status,'INDISPONIVEL',why); assert.equal(r.window,null,why); assert.equal(confirmedTotal(r),0,why); assert.equal(calls.some(c=>c[0]==='units'),false,why);
  }
  const {deps}=mk(); assert.equal((await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps)).window.last_complete_day,'2026-11-23','resposta correta continua valendo');
});
