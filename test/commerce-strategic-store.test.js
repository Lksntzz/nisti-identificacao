// GA-013 — Visão estratégica: montagem no servidor (store) e rota. Dados fictícios, dependências injetadas, sem rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {commerceStrategicViewV1} from '../src/ga/commerce-supabase-store.js';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const router=read('src/ga/commerce-admin-router.js'),store=read('src/ga/commerce-supabase-store.js');

const dash=p=>({platform:p,days:7,first_day:'2025-01-01',last_day:'2026-11-23',current_start:'2026-11-17',previous_start:'2026-11-10',
  totals:{cur_units:14,prev_units:10},drops:{items:[]}});
const dq=(platform,start,end,days,complete=true)=>({platform,period:{start,end},sales:{status:complete?'COMPLETA':'PARCIAL',requested_days:days,
  complete_days:complete?days:days-1,partial_days:0,days_without_information:complete?0:1,days_with_records_unverified:0,missing_ranges:complete?[]:[{start,end:start,days:1}]}});
const mk=(over={})=>{
  const calls=[];
  const deps={
    dashboard:async (_e,a)=>{calls.push(['dashboard',a]);return dash(a.platform);},
    overview:async (_e,a)=>{calls.push(['overview',a]);return {listings:{active:1},top_units:[],growth:[],stopped:[],no_sales:[]};},
    monthly:async (_e,a)=>{calls.push(['monthly',a]);return {months:[]};},
    series:async (_e,a)=>{calls.push(['series',a]);return {daily:[]};},
    categories:async (_e,a)=>{calls.push(['categories',a]);return {platform:a.platform,cur_from:'2026-11-17',cur_to:'2026-11-23',base_from:'2025-11-17',base_to:'2025-11-23',total:{cur:1,base:1},categories:[]};},
    shopeePerf:async()=>({reports:[],items:{}}),mlPerf:async()=>({reports:[],items:{}}),
    quality:async(_e,a)=>{calls.push(['quality',a]);return dq(a.platform,a.start,a.end,Math.round((Date.parse(a.end)-Date.parse(a.start))/86400000)+1);},
    split:async(_e,a)=>{calls.push(['split',a]);return {status:'COMPLETO',total_units:14,linked_units:14,unlinked_units:0,base_units:14,
      difference:{units:0,unlinked_effect_units:0,other_explained_units:0,residual_units:0,explained:true},
      reconciliation:{status:'EXPLICADA',source_units_match:true,identity_ok:true},coverage:{missing_days:0,days_with_data:7,missing_ranges:[]}};},
    ...over};
  return {deps,calls};
};

test('store: monta a visão pedindo cada parte para a MESMA conta e para os períodos do Dashboard',async()=>{
  const {deps,calls}=mk();
  const v=await commerceStrategicViewV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(v.platform,'SHOPEE'); assert.equal(v.units.current,14);
  for(const [name,a] of calls.filter(c=>['dashboard','overview','monthly','series','categories','quality'].includes(c[0])))
    assert.equal(a.platform,'SHOPEE',name+' pediu outra conta');
  const q=calls.filter(c=>c[0]==='quality').map(c=>[c[1].start,c[1].end]);
  assert.deepEqual(q.slice(0,3),[['2026-11-17','2026-11-23'],['2026-11-10','2026-11-16'],['2025-01-01','2026-11-23']]);
  assert.deepEqual(q.slice(3),[['2025-11-17','2025-11-23']],'base anual das categorias é verificada; o período atual alinhado é reaproveitado');
  assert.deepEqual(calls.find(c=>c[0]==='split')[1],{start:'2026-11-17',end:'2026-11-23'});
  assert.deepEqual(calls.find(c=>c[0]==='categories')[1],{platform:'SHOPEE',mode:'days',days:7});
  assert.equal(v.units.verified.current,true); assert.equal(v.units.verified.previous,true);
});

test('store: ML não pede a divisão total x vinculada e nunca recebe cobertura de outra conta',async()=>{
  const {deps,calls}=mk({quality:async(_e,a)=>dq('SHOPEE',a.start,a.end,7)});
  const v=await commerceStrategicViewV1({},{platform:'ML_NOVO',days:7},deps);
  assert.equal(calls.some(c=>c[0]==='split'),false);
  assert.equal(v.units.verified.current,false,'cobertura da Shopee não comprova o ML Novo');
});

test('store: parte que falha vira indisponível e o resto continua',async()=>{
  const {deps}=mk({categories:async()=>{throw new Error('segredo-interno');},split:async()=>{throw new Error('x');}});
  const v=await commerceStrategicViewV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(v.parts.categories,'INDISPONIVEL'); assert.equal(v.parts.split,'INDISPONIVEL'); assert.equal(v.parts.overview,'OK');
  assert.equal(v.units.current,14);
  assert.doesNotMatch(JSON.stringify(v),/segredo-interno/);
});

test('store: histórico maior que 1100 dias não é afirmado como comprovado',async()=>{
  const {deps,calls}=mk({dashboard:async (_e,a)=>({...dash(a.platform),first_day:'2020-01-01'})});
  const v=await commerceStrategicViewV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(calls.filter(c=>c[0]==='quality').length,3,'atual, anterior e base anual das categorias; sem histórico');
  assert.equal(v.coverage.history.proven,false);
});

test('store: recusa conta fora das três e janela inválida',async()=>{
  const {deps}=mk();
  await assert.rejects(()=>commerceStrategicViewV1({},{platform:'TODAS',days:7},deps));
  await assert.rejects(()=>commerceStrategicViewV1({},{platform:'SHOPEE',days:15},deps));
});

test('rota: só as três contas, janelas 7/30/60/90, fora do cache de borda e sem escrita',()=>{
  const i=router.indexOf("BASE_PATH+'/strategic-view'");
  assert.ok(i>0,'rota existe');
  const block=router.slice(i-40,i+700);
  assert.ok(block.includes("['SHOPEE','ML_ANTIGO','ML_NOVO'].includes(platform)")&&!/'TODAS'/.test(block));
  assert.ok(block.includes('[7,30,60,90].includes(days)'));
  assert.ok(block.includes('commerceStrategicViewV1'));
  assert.ok(!router.slice(i,i+700).includes('sales-dashboard/strategic'),'não pode ficar sob o prefixo cacheado');
  const fn=store.slice(store.indexOf('export async function commerceStrategicViewV1'));
  assert.doesNotMatch(fn,/method:\s*'(POST|PUT|DELETE|PATCH)'/);
  assert.doesNotMatch(fn,/cachedRpc\(env,'commerce_data_quality_v1'/);
});

test('store: categorias desalinhadas pedem a cobertura do próprio período delas',async()=>{
  const {deps,calls}=mk({categories:async(_e,a)=>({platform:a.platform,cur_from:'2026-11-18',cur_to:'2026-11-24',base_from:'2025-11-18',base_to:'2025-11-24',total:{cur:1,base:1},categories:[]})});
  const v=await commerceStrategicViewV1({},{platform:'SHOPEE',days:7},deps);
  const q=calls.filter(c=>c[0]==='quality').map(c=>c[1].start+'|'+c[1].end);
  assert.ok(q.includes('2026-11-18|2026-11-24')&&q.includes('2025-11-18|2025-11-24'));
  assert.equal(v.categories.aligned,false); assert.ok(v.notices.some(n=>n.kind==='CATEGORIAS_PERIODO_DIFERENTE'));
  assert.equal(typeof v.sources.elapsed_ms,'number');
});
test('store: resposta de outra conta devolvida por uma consulta é rejeitada',async()=>{
  const {deps}=mk({overview:async()=>({platform:'ML_NOVO',listings:{active:9},top_units:[],growth:[],stopped:[],no_sales:[]})});
  const v=await commerceStrategicViewV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(v.parts.overview,'RESPOSTA_INVALIDA'); assert.equal(v.movements.growth.available,false);
});

// ---- GA-P02: concorrência limitada, consultas repetidas evitadas, ordem e métricas ----
const withPeak=deps=>{const st={active:0,peak:0,order:[],total:0};
  const wrap=(name,fn)=>async(...a)=>{st.active++;st.total++;st.order.push(name);st.peak=Math.max(st.peak,st.active);try{await new Promise(r=>setTimeout(r,5));return await fn(...a);}finally{st.active--;}};
  const out={};for(const [k,fn] of Object.entries(deps))out[k]=wrap(k,fn);return {deps:out,st};};
test('GA-P02: nunca mais de 3 consultas ao banco ao mesmo tempo, em todas as contas e janelas',async()=>{
  for(const platform of ['SHOPEE','ML_ANTIGO','ML_NOVO'])for(const days of [7,30,60,90]){
    const {deps}=mk();const {deps:w,st}=withPeak(deps);
    const v=await commerceStrategicViewV1({},{platform,days},w);
    assert.ok(st.peak<=3,platform+' '+days+': pico '+st.peak);assert.ok(st.peak>=2,'ainda usa paralelismo');
    assert.equal(v.metrics.max_parallel,3);assert.equal(v.metrics.queries,st.total);
  }
});
test('GA-P02: o Dashboard sai primeiro e as consultas lentas (cobertura/divisão) entram antes das partes em cache',async()=>{
  const {deps}=mk();const {deps:w,st}=withPeak(deps);
  await commerceStrategicViewV1({},{platform:'SHOPEE',days:7},w);
  assert.equal(st.order[0],'dashboard');
  const first=st.order.indexOf('quality'),mon=st.order.indexOf('monthly');
  assert.ok(first>0&&first<mon,'cobertura entra na fila antes do mensal: '+st.order.join(','));
});
test('GA-P02: consulta de cobertura idêntica (mesma conta, início e fim) é feita uma vez só',async()=>{
  // categorias com as mesmas datas do período atual e base igual ao período anterior => nenhuma repetição
  const {deps,calls}=mk({categories:async(_e,a)=>({platform:a.platform,cur_from:'2026-11-17',cur_to:'2026-11-23',base_from:'2026-11-10',base_to:'2026-11-16',total:{cur:1,base:1},categories:[]})});
  const v=await commerceStrategicViewV1({},{platform:'ML_NOVO',days:7},deps);
  const keys=calls.filter(c=>c[0]==='quality').map(c=>c[1].start+'|'+c[1].end);
  assert.equal(new Set(keys).size,keys.length,'nenhuma cobertura repetida');
  assert.ok(v.metrics.shared_queries>=1,'a base de categorias reaproveitou a cobertura do período anterior');
  assert.equal(v.categories.verified.base,true);
});
test('GA-P02: métricas — tempo, consultas, falhas e fases; falha de uma parte não derruba as outras',async()=>{
  const {deps}=mk({series:async()=>{throw new Error('x');},split:async()=>{throw new Error('y');}});
  const v=await commerceStrategicViewV1({},{platform:'SHOPEE',days:7},deps);
  assert.deepEqual(v.metrics.failed.sort(),['series','split']);assert.equal(v.metrics.failed_count,2);
  assert.ok(v.metrics.queries>=8&&v.metrics.elapsed_ms>=0&&typeof v.metrics.phases_ms.dashboard==='number');
  assert.equal(v.parts.series,'INDISPONIVEL');assert.equal(v.parts.dashboard,'OK');
  assert.ok(!JSON.stringify(v.metrics).match(/PROD|SKU|sku/));
});
test('GA-P02: conta indisponível no Dashboard não dispara cobertura nem divisão (nada é inventado)',async()=>{
  const {deps,calls}=mk({dashboard:async()=>{throw new Error('x');}});
  const v=await commerceStrategicViewV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(calls.filter(c=>c[0]==='quality'||c[0]==='split').length,0);assert.equal(v.parts.dashboard,'INDISPONIVEL');
});
test('GA-P02: duas contas ao mesmo tempo não misturam respostas (limitador por operação)',async()=>{
  const a=mk(),b=mk();
  const [va,vb]=await Promise.all([commerceStrategicViewV1({},{platform:'SHOPEE',days:7},withPeak(a.deps).deps),commerceStrategicViewV1({},{platform:'ML_NOVO',days:7},withPeak(b.deps).deps)]);
  assert.equal(va.platform,'SHOPEE');assert.equal(vb.platform,'ML_NOVO');
  assert.ok(a.calls.every(c=>c[1].platform==null||c[1].platform==='SHOPEE'));assert.ok(b.calls.every(c=>c[1].platform==null||c[1].platform==='ML_NOVO'));
});

// ---- GA-P02A etapa 1: concorrência configurável SÓ da Visão estratégica; fila e chamada medidas separadamente ----
import {strategicParallel} from '../src/ga/commerce-supabase-store.js';
import {MAX_PARALLEL_DB} from '../src/ga/commerce-concurrency.js';
const volatile=v=>{const c=JSON.parse(JSON.stringify(v));delete c.metrics;if(c.sources)delete c.sources.elapsed_ms;return c;};
test('GA-P02A: strategicParallel aceita só 1..3; inválido ou ausente volta ao padrão 3; MAX_PARALLEL_DB não muda',()=>{
  assert.equal(MAX_PARALLEL_DB,3);
  assert.equal(strategicParallel({}),3);
  assert.equal(strategicParallel({GA_STRATEGIC_PARALLEL:'1'}),1);assert.equal(strategicParallel({GA_STRATEGIC_PARALLEL:' 2 '}),2);
  assert.equal(strategicParallel({GA_STRATEGIC_PARALLEL:2}),2);assert.equal(strategicParallel({},1),1);
  for(const bad of ['0','4','-1','2.5','abc','','Infinity',null,undefined,{},[]])assert.equal(strategicParallel({GA_STRATEGIC_PARALLEL:bad}),3,'inválido: '+String(bad));
  assert.equal(strategicParallel({GA_STRATEGIC_PARALLEL:'1'},9),3,'override inválido nunca vira ilimitado');
});
test('GA-P02A: com 1 ou 2 consultas simultâneas o pico respeita o limite em todas as contas e janelas',async()=>{
  for(const par of [1,2])for(const platform of ['SHOPEE','ML_ANTIGO','ML_NOVO'])for(const days of [7,30,60,90]){
    const {deps}=mk();const {deps:w,st}=withPeak(deps);
    const v=await commerceStrategicViewV1({},{platform,days,parallel:par},w);
    assert.ok(st.peak<=par,par+' '+platform+' '+days+': pico '+st.peak);assert.equal(v.metrics.max_parallel,par);assert.equal(v.metrics.queries,st.total);
  }
});
test('GA-P02A: a variável de ambiente controla a simultaneidade e a URL não tem como mudá-la',async()=>{
  const {deps}=mk();const {deps:w,st}=withPeak(deps);
  const v=await commerceStrategicViewV1({GA_STRATEGIC_PARALLEL:'1'},{platform:'SHOPEE',days:30},w);
  assert.equal(st.peak,1);assert.equal(v.metrics.max_parallel,1);
  const route=router.slice(router.indexOf("pathname===BASE_PATH+'/strategic-view'"),router.indexOf("pathname===BASE_PATH+'/strategic-view'")+900);
  assert.ok(!/parallel/i.test(route),'a rota não lê paralelismo da URL');
});
test('GA-P02A: resultado idêntico com 1, 2 e 3 consultas simultâneas (mesmos dados, mesma cobertura, mesmas falhas)',async()=>{
  for(const platform of ['SHOPEE','ML_ANTIGO','ML_NOVO'])for(const days of [7,30,60,90]){
    const out=[];
    for(const par of [1,2,3]){const {deps}=mk();out.push(volatile(await commerceStrategicViewV1({},{platform,days,parallel:par},withPeak(deps).deps)));}
    assert.deepEqual(out[0],out[1],platform+' '+days+': 1 x 2');assert.deepEqual(out[0],out[2],platform+' '+days+': 1 x 3');
  }
  const bad={series:async()=>{throw new Error('x');},split:async()=>{throw new Error('y');}};
  const a=volatile(await commerceStrategicViewV1({},{platform:'SHOPEE',days:30,parallel:1},mk(bad).deps));
  const b=volatile(await commerceStrategicViewV1({},{platform:'SHOPEE',days:30,parallel:3},mk(bad).deps));
  assert.deepEqual(a,b,'a falha parcial é a mesma');
});
test('GA-P02A: a ordem de prioridade é a mesma com 1 consulta (Dashboard primeiro, cobertura antes do mensal)',async()=>{
  const {deps}=mk();const {deps:w,st}=withPeak(deps);
  await commerceStrategicViewV1({},{platform:'SHOPEE',days:7,parallel:1},w);
  assert.equal(st.order[0],'dashboard');assert.ok(st.order.indexOf('quality')<st.order.indexOf('monthly'));
});
test('GA-P02A: fila e chamada são medidas separadamente (relógio injetado, sem depender de tempo real)',async()=>{
  // Relógio falso: cada chamada "dura" 10 ms de relógio; com 1 consulta por vez, a espera de cada parte é a soma das anteriores.
  let t=0;const advance=ms=>{t+=ms;};
  const {deps}=mk();const slow={};for(const [k,fn] of Object.entries(deps))slow[k]=async(...a)=>{const r=await fn(...a);advance(10);return r;};
  slow.now=()=>t;
  const v=await commerceStrategicViewV1({},{platform:'ML_NOVO',days:7,parallel:1},slow);
  const m=v.metrics;
  assert.equal(m.max_parallel,1);assert.equal(m.call_ms,m.queries*10,'cada chamada medida tem 10 ms');
  assert.ok(m.queue_wait_ms>0,'com 1 por vez existe espera');
  assert.equal(Object.values(m.parts).reduce((a,x)=>a+x.n,0),m.queries);
  for(const x of Object.values(m.parts)){assert.ok(x.call_ms>=0&&x.wait_ms>=0);}
  assert.ok(!JSON.stringify(m).match(/PROD|SKU|sku/));
});
test('GA-P02A: chamada que falha também registra o tempo de chamada e a espera',async()=>{
  const {deps}=mk({series:async()=>{await new Promise(r=>setTimeout(r,15));throw new Error('x');}});
  const v=await commerceStrategicViewV1({},{platform:'SHOPEE',days:7,parallel:2},deps);
  assert.ok(v.metrics.failed.includes('series'));assert.ok(v.metrics.parts.series.call_ms>=10);assert.equal(v.metrics.parts.series.n,1);
});
test('GA-P02A: o log da rota inclui simultaneidade, espera e chamada, sem dados de venda',()=>{
  const http=read('src/ga/commerce-abc-http.js');
  assert.ok(http.includes('parallel:data?.metrics?.max_parallel')&&http.includes('wait_ms:data?.metrics?.queue_wait_ms')&&http.includes('call_ms:data?.metrics?.call_ms'));
});
test('GA-P02A: Evolução ABC continua com MAX_PARALLEL_DB fixo (não lê GA_STRATEGIC_PARALLEL)',()=>{
  const abc=read('src/ga/commerce-abc-store.js');
  assert.ok(/makeLimiter\(MAX_PARALLEL_DB\)/.test(abc));assert.ok(!/GA_STRATEGIC_PARALLEL|strategicParallel/.test(abc));
  assert.ok(!/GA_STRATEGIC_PARALLEL/.test(read('src/ga/commerce-concurrency.js')));
});
