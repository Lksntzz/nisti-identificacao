// GA-013 — Chromium real: Visão estratégica com API SIMULADA (dados fictícios). Cobre troca rápida de conta, respostas fora de ordem,
// períodos não comprovados, falhas parciais, resposta de outra conta e capturas das três contas.
// NUNCA executar contra workers.dev, Supabase ou endpoints externos de produção.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {buildStrategicView,strategicPeriods} from '../src/ga/commerce-strategic-logic.js';

const BASE=process.env.NISTI_HARNESS_BASE||'http://127.0.0.1:4173';
const URL_VIEW=BASE+'/test-browser/harness/strategic-view.html';
const SHOTS=process.env.NISTI_SHOTS_DIR||'';
const UNITS={SHOPEE:111,ML_ANTIGO:222,ML_NOVO:333}; // fictícios e distintos por conta
const NAME={SHOPEE:'Shopee',ML_ANTIGO:'ML Antigo',ML_NOVO:'ML Novo'};
const tests=[];const test=(name,fn)=>tests.push({name,fn});

const mkDash=(platform,days,over={})=>({platform,days,first_day:'2025-01-01',last_day:'2026-11-23',current_start:days===7?'2026-11-17':'2026-10-25',
  previous_start:days===7?'2026-11-10':'2026-09-25',totals:{cur_units:UNITS[platform],prev_units:UNITS[platform]-20,cur_rev:1,prev_rev:1},
  drops:{total:57,items:[{listing_id:2,platform,external_id:'B2',title:'Capa Floral '+NAME[platform],units:2,units_previous:10}]},...over});
const dq=(platform,start,end,ok=true)=>{const span=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
  return {platform,period:{start,end},sales:{status:ok?'COMPLETA':'PARCIAL',requested_days:span,complete_days:ok?span:span-3,partial_days:0,
    days_without_information:ok?0:3,days_with_records_unverified:0,missing_ranges:ok?[]:[{start,end:start,days:3}]}};};
// Monta a resposta com a MESMA lógica do servidor, a partir de dados brutos fictícios.
export function payload(platform,days,{proven=true,failed=[],over={},prevOk=proven}={}){
  const dash=mkDash(platform,days,over.dash||{}),periods=strategicPeriods(dash);
  const cur=periods.current,prev=periods.previous,hist=periods.history;
  return buildStrategicView({platform,days,dash,periods,failed,
    overview:failed.includes('overview')?null:{listings:{active:30,inactive:4,active_without_sales:5},
      top_units:[{listing_id:1,platform,external_id:'A1',title:'Agenda '+NAME[platform]+' Campeã',units:80,units_previous:50}],
      growth:[{listing_id:1,platform,external_id:'A1',title:'Agenda '+NAME[platform]+' Campeã',units:80,units_previous:50}],
      stopped:[{listing_id:3,platform,external_id:'C3',title:'Caderno Parado',units_ever:30,last_sale:'2026-10-01',days_since:53}],stopped_total:400,
      no_sales:[{listing_id:4,platform,external_id:'D4',title:'Anúncio Sem Venda',units_ever:0,last_sale:null}],no_sales_never:9,unlinked:{listings:2}},
    monthly:{months:[{month:'2026-10',['units_'+({SHOPEE:'shopee',ML_ANTIGO:'ml_antigo',ML_NOVO:'ml_novo'}[platform])]:120,days_with_sales:31}]},
    series:{daily:[{day:'2026-11-23',['units_'+({SHOPEE:'shopee',ML_ANTIGO:'ml_antigo',ML_NOVO:'ml_novo'}[platform])]:22}]},
    categories:failed.includes('categories')?null:{platform,cur_from:cur.start,cur_to:cur.end,base_from:'2025'+cur.start.slice(4),base_to:'2025'+cur.end.slice(4),
      total:{cur:UNITS[platform],base:90},categories:[{name:'Agendas',cur:90,base:60,cols:[{name:'Floral',cur:50,base:30}]}]},
    split:platform==='SHOPEE'?{status:'COMPLETO',total_units:UNITS[platform]+5,linked_units:UNITS[platform],unlinked_units:5,base_units:UNITS[platform],
      difference:{units:-5,other_explained_units:0,residual_units:0},reconciliation:{status:'EXPLICADA'},coverage:{missing_days:0}}:null,
    dqCurrent:proven?dq(platform,cur.start,cur.end):dq(platform,cur.start,cur.end,false),
    dqPrevious:prevOk?dq(platform,prev.start,prev.end):dq(platform,prev.start,prev.end,false),
    dqHistory:dq(platform,hist.start,hist.end,false),dqCatBase:dq(platform,'2025'+cur.start.slice(4),'2025'+cur.end.slice(4)),
    perf:{shopee:{reports:[],items:{}},ml:{reports:[],items:{}}},...over.parts});
}

function createSimulator(){
  const calls=[];const holds=new Map();const opts={mode:{},fail:{}};
  const key=(p,d)=>p+'|'+d;
  const hold=(p,d=7)=>{let release;const gate=new Promise(r=>{release=r;});holds.set(key(p,d),{gate,release});};
  const release=(p,d=7)=>holds.get(key(p,d))?.release();
  const handler=async route=>{
    const req=route.request(),url=new URL(req.url());
    calls.push({path:url.pathname,method:req.method(),query:Object.fromEntries(url.searchParams)});
    const json=(b,s=200)=>route.fulfill({status:s,contentType:'application/json',body:JSON.stringify(b)});
    if(req.method()!=='GET')return json({error:'Escrita bloqueada no teste'},403);
    if(url.pathname!=='/api/admin/commerce/strategic-view')return json({});
    const platform=url.searchParams.get('platform'),days=Number(url.searchParams.get('days'));
    if(!UNITS[platform]||![7,30,60,90].includes(days))return json({error:'Filtro da Visão estratégica inválido.'},400);
    const h=holds.get(key(platform,days));if(h)await h.gate;
    const k=key(platform,days),m=opts.mode[k]||opts.mode[platform]||{};
    if(opts.fail[platform])return json({error:'falha simulada'},500);
    if(m.wrongPlatform)return json({...payload('ML_NOVO',days),platform:'ML_NOVO'});
    if(m.wrongDays)return json({...payload(platform,days),days:days===7?30:7});
    return json(payload(platform,days,m));
  };
  return {handler,calls,hold,release,opts};
}
async function open(browser,{sim=createSimulator(),viewport={width:1365,height:1100}}={}){
  const context=await browser.newContext({viewport,serviceWorkers:'block',locale:'pt-BR',timezoneId:'America/Sao_Paulo'});
  await context.route('**/api/**',sim.handler);
  const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(URL_VIEW,{waitUntil:'domcontentloaded'});
  return {page,context,sim,errors};
}
const pick=(page,id)=>page.locator('[aria-label="Conta"] button',{hasText:NAME[id]});
const unitsText=page=>page.locator('[data-testid="units-current"]').innerText();
const num=n=>Number(n).toLocaleString('pt-BR');
const body=page=>page.locator('.nsv-root').evaluate(e=>e.textContent);

test('as três contas: números distintos, menu só com três contas e nenhum pedido de Consolidado',async b=>{
  const {page,sim,context,errors}=await open(b);
  const labels=await page.locator('[aria-label="Conta"] button').allInnerTexts();
  assert.deepEqual(labels.map(s=>s.trim()),['Shopee','ML Antigo','ML Novo']);
  for(const id of ['SHOPEE','ML_ANTIGO','ML_NOVO']){
    await pick(page,id).click();
    await page.waitForFunction(n=>document.querySelector('[data-testid="units-current"]')?.textContent===n,num(UNITS[id]));
    const t=await body(page);
    assert.doesNotMatch(t,/faturamento|lucro|margem|ticket|R\$/i);
    assert.match(t,/não é um ranking por unidades/);
    assert.match(t,/Período atual: 2026-11-17 a 2026-11-23/);
    assert.match(t,/ano anterior/i); assert.match(t,/Comparação anual/);
    if(SHOTS){mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:SHOTS+'/'+id.toLowerCase()+'-7dias.png',fullPage:true});}
  }
  assert.equal(sim.calls.some(c=>/TODAS/.test(JSON.stringify(c.query))),false);
  assert.equal(sim.calls.every(c=>c.method==='GET'),true);
  assert.deepEqual(errors,[]);await context.close();
});

test('troca rápida: resposta lenta da conta anterior nunca aparece na conta atual',async b=>{
  const sim=createSimulator();sim.hold('SHOPEE',7);
  const {page,context,errors}=await open(b,{sim}); // a primeira conta (Shopee) fica pendurada
  await pick(page,'ML_ANTIGO').click();
  await pick(page,'ML_NOVO').click();
  await page.waitForFunction(n=>document.querySelector('[data-testid="units-current"]')?.textContent===n,num(UNITS.ML_NOVO));
  sim.release('SHOPEE',7);await page.waitForTimeout(400);
  assert.equal(await unitsText(page),num(UNITS.ML_NOVO));
  assert.doesNotMatch(await body(page),/Agenda Shopee|Capa Floral Shopee/);
  assert.deepEqual(errors,[]);await context.close();
});

test('troca rápida de período: resposta de 7 dias não aparece sob 30 dias',async b=>{
  const sim=createSimulator();sim.hold('SHOPEE',7);
  const {page,context}=await open(b,{sim});
  await page.locator('[aria-label="Período"] button',{hasText:'30 dias'}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="units-current"]'));
  sim.release('SHOPEE',7);await page.waitForTimeout(400);
  assert.match(await body(page),/anterior: 2026-09-25/);
  await context.close();
});

test('período não comprovado: candidatos, sem classificação confirmada e sem variação',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={proven:false,prevOk:false};
  const {page,context}=await open(b,{sim});
  await page.waitForSelector('[data-testid="units-current"]');
  const t=await body(page);
  assert.match(t,/Possíveis quedas \(não confirmadas\)/);assert.match(t,/Possível crescimento \(não confirmado\)/);
  assert.match(t,/Possíveis parados \(não confirmados\)/);assert.match(t,/Sem venda nos dados importados \(histórico não verificado\)/);
  assert.match(t,/57 possíveis quedas/);
  assert.equal(await page.locator('h3',{hasText:/^Queda$/}).count(),0);assert.equal(await page.locator('h3',{hasText:/^Crescimento$/}).count(),0);
  assert.match(await page.locator('.nsv-kpis').innerText(),/—/);
  assert.match(t,/não verificado/);
  if(SHOTS)await page.screenshot({path:SHOTS+'/shopee-30dias-nao-comprovado.png',fullPage:true});
  await context.close();
});

test('período comprovado: títulos confirmados e histórico importado identificado',async b=>{
  const {page,context}=await open(b);
  await page.waitForSelector('[data-testid="units-current"]');
  const t=await body(page);
  assert.equal(await page.locator('h3',{hasText:/^Queda$/}).count(),1);
  assert.match(t,/57 anúncios em queda/);
  assert.match(t,/Sem venda nos dados importados \(histórico não verificado\)/); // histórico fictício parcial
  assert.doesNotMatch(t,/nunca vendeu|nunca venderam/i);
  assert.match(t,/Outra base, não somar: total por SKU/);
  assert.match(t,/vendas dos anúncios vinculados/);
  await context.close();
});

test('falhas parciais: indisponível não vira lista vazia e o resto continua',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={failed:['overview','categories']};
  const {page,context}=await open(b,{sim});
  await page.waitForSelector('[data-testid="units-current"]');
  const t=await body(page);
  assert.match(t,/Consulta indisponível no momento/);assert.match(t,/Categorias indisponíveis no momento/);
  assert.match(t,/Partes indisponíveis ou descartadas/);
  assert.doesNotMatch(await page.locator('section',{hasText:/Anúncios que pararam|Possíveis parados/}).first().innerText(),/Nenhum anúncio nesta lista/);
  assert.equal(await unitsText(page),num(UNITS.SHOPEE));
  if(SHOTS)await page.screenshot({path:SHOTS+'/shopee-falha-parcial.png',fullPage:true});
  await context.close();
});

test('resposta de outra conta ou de outro período é descartada pela tela',async b=>{
  for(const mode of [{wrongPlatform:true},{wrongDays:true}]){
    const sim=createSimulator();sim.opts.mode.SHOPEE=mode;
    const {page,context}=await open(b,{sim});
    await page.waitForSelector('.nsv-error[role="alert"]');
    assert.match(await body(page),/foi descartada/);
    assert.equal(await page.locator('[data-testid="units-current"]').count(),0);
    await context.close();
  }
});

test('erro do servidor: mensagem clara, sem dados antigos e botão Atualizar recupera',async b=>{
  const sim=createSimulator();sim.opts.fail.ML_NOVO=true;
  const {page,context}=await open(b,{sim});
  await pick(page,'ML_NOVO').click();
  await page.waitForSelector('.nsv-error[role="alert"]');
  assert.equal(await page.locator('[data-testid="units-current"]').count(),0);
  sim.opts.fail.ML_NOVO=false;
  await page.getByRole('button',{name:'Atualizar'}).click();
  await page.waitForFunction(n=>document.querySelector('[data-testid="units-current"]')?.textContent===n,num(UNITS.ML_NOVO));
  await context.close();
});

test('celular: sem rolagem horizontal',async b=>{
  const {page,context}=await open(b,{viewport:{width:390,height:844}});
  await page.waitForSelector('[data-testid="units-current"]');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
  if(SHOTS)await page.screenshot({path:SHOTS+'/shopee-celular.png',fullPage:true});
  await context.close();
});

const launchOpts=process.env.NISTI_CHROMIUM?{executablePath:process.env.NISTI_CHROMIUM,args:['--no-sandbox','--disable-gpu']}:{};
const browser=await chromium.launch(launchOpts);
let failed=0;
for(const t of tests){
  try{await t.fn(browser);console.log('ok  - '+t.name);}
  catch(e){failed++;console.log('FAIL- '+t.name+'\n  '+String(e.message).split('\n').slice(0,6).join('\n  '));}
}
await browser.close();
if(failed){console.log(failed+' falha(s)');process.exit(1);}
console.log('Todos os '+tests.length+' testes de navegador passaram.');
