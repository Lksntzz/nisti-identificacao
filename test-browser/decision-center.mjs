// GA-014 — Chromium real: Central de decisões com API SIMULADA (dados fictícios, nos formatos reais). Cobre troca rápida de conta e de
// período, períodos não comprovados, falhas parciais, resposta de outra conta, só GET, ausência de termos financeiros e capturas.
// NUNCA executar contra workers.dev, Supabase ou endpoints externos de produção.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {buildDecisionCenter} from '../src/ga/commerce-decision-logic.js';
import {strategicPeriods} from '../src/ga/commerce-strategic-logic.js';
import {units as fxUnits,reports as fxReports,splitOf} from '../test/fixtures-decision.js';

const BASE=process.env.NISTI_HARNESS_BASE||'http://127.0.0.1:4173';
const URL_VIEW=BASE+'/test-browser/harness/decision-center.html';
const SHOTS=process.env.NISTI_SHOTS_DIR||'';
const NAME={SHOPEE:'Shopee',ML_ANTIGO:'ML Antigo',ML_NOVO:'ML Novo'};
const TAG={SHOPEE:'S',ML_ANTIGO:'MA',ML_NOVO:'MN'};
const tests=[];const test=(name,fn)=>tests.push({name,fn});

const mkDash=(platform,days)=>({platform,days,first_day:'2025-01-01',last_day:'2026-11-23',current_start:days===7?'2026-11-17':'2026-10-25',
  previous_start:days===7?'2026-11-10':'2026-09-25',totals:{cur_units:0,prev_units:0}});
const dq=(platform,start,end,ok=true)=>{const span=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
  return {platform,period:{start,end},sales:{status:ok?'COMPLETA':'PARCIAL',requested_days:span,complete_days:ok?span:span-3,partial_days:0,
    days_without_information:ok?0:3,days_with_records_unverified:0,missing_ranges:ok?[]:[{start,end:start,days:3}]}};};
const row=(platform,id,uc,up,o={})=>({ext:TAG[platform]+id,listing_id:Number(id),title:'Caderno '+NAME[platform]+' '+id,registered:true,ambiguous_status:false,status:'ACTIVE',
  status_checked_at:'2026-11-17T11:17:46+00:00',units_current:uc,units_previous:up,last_sale:'2026-11-22',first_sale:'2026-01-05',perf:{latest:null,previous:null},...o});
// Resposta fictícia de commerce_decision_units_v1, com os mesmos campos reais.
function unitsOf(platform,days,{many=false,cur,prev}={}){
  const periods=strategicPeriods(mkDash(platform,days));
  const rows=[row(platform,'1',10,30),row(platform,'2',0,8),row(platform,'3',24,10),row(platform,'4',8,0),row(platform,'5',10,10),
    row(platform,'6',4,20,{status:'PAUSED'}),row(platform,'7',3,25,{registered:false,status:null,status_checked_at:null,title:null,listing_id:null}),
    row(platform,'8',9,9,{perf:{latest:{ambiguous_rows:false,impressions:5000,clicks:200,visits:400,orders:2},previous:null}})];
  if(many)for(let i=0;i<60;i++)rows.push(row(platform,String(100+i),5,30+i));
  return fxUnits(rows,{platform:cur||platform,current:prev?{start:'2026-11-18',end:'2026-11-23'}:periods.current,previous:periods.previous,
    reports:fxReports(['2026-11-16','2026-11-22',{store_visits:4000,store_orders:200}],null)});
}
export function payload(platform,days,{proven=true,prevUnproven=false,diverge=false,failUnits=false,many=false,split=true}={}){
  const u=unitsOf(platform,days,{many});
  const dash={...mkDash(platform,days),totals:{cur_units:u.totals.units_current+(diverge?7:0),prev_units:u.totals.units_previous}};
  const periods=strategicPeriods(dash);
  return buildDecisionCenter({platform,days,dash,periods,units:failUnits?null:u,failed:failUnits?['units']:[],
    dqCurrent:dq(platform,periods.current.start,periods.current.end,proven),dqPrevious:dq(platform,periods.previous.start,periods.previous.end,proven&&!prevUnproven),
    split:platform==='SHOPEE'&&split?{current:splitOf(periods.current.start,periods.current.end,{total:u.totals.units_current+4,linked:u.totals.units_current}),
      previous:splitOf(periods.previous.start,periods.previous.end,{total:u.totals.units_previous+4,linked:u.totals.units_previous})}:null});
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
    if(url.pathname!=='/api/admin/commerce/decision-center')return json({});
    const platform=url.searchParams.get('platform'),days=Number(url.searchParams.get('days'));
    if(!NAME[platform]||![7,30].includes(days))return json({error:'Filtro da Central de decisões inválido.'},400);
    const h=holds.get(key(platform,days));if(h)await h.gate;
    const m=opts.mode[key(platform,days)]||opts.mode[platform]||{};
    if(opts.fail[platform])return json({error:'falha simulada'},500);
    if(m.wrongPlatform)return json(payload('ML_NOVO',days));
    if(m.wrongDays)return json(payload(platform,days===7?30:7));
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
const body=page=>page.locator('[data-testid="decision-center"]').evaluate(e=>e.textContent);
const ready=(page,id)=>page.waitForFunction(n=>document.querySelector('[data-testid="decision-center"] tbody')?.textContent.includes(n),'Caderno '+NAME[id]);

test('três contas: faixas, contagens, só GET, sem termos financeiros e capturas',async b=>{
  const {page,sim,context,errors}=await open(b);
  const labels=await page.locator('[aria-label="Conta"] button').allInnerTexts();
  assert.deepEqual(labels.map(s=>s.trim()),['Shopee','ML Antigo','ML Novo']);
  for(const id of ['SHOPEE','ML_ANTIGO','ML_NOVO']){
    await pick(page,id).click();await ready(page,id);
    const t=await body(page);
    assert.doesNotMatch(t,/faturamento|lucro|margem|ticket|R\$|receita/i);
    assert.match(t,/Somente leitura: o GA não altera anúncios/);
    assert.match(t,/Atual: 2026-11-17 a 2026-11-23/);
    assert.equal(await page.locator('[data-testid="count-alta"]').innerText(),'2');
    assert.equal(await page.locator('[data-testid="count-revisao"]').innerText(),'1');
    assert.equal(await page.locator('[data-testid="count-oportunidade"]').innerText(),'2');
    assert.equal(await page.locator('[data-testid="count-hipotese_conversao"]').innerText(),'1');
    assert.equal(await page.locator('[data-testid="count-insuficiente"]').innerText(),'1');
    assert.equal(await page.locator('[data-testid="count-sem_prioridade"]').innerText(),'1');
    assert.equal(await page.locator('button',{hasText:/aplicar|alterar|salvar|excluir|pausar|reduzir/i}).count(),0,'nenhum botão que altere anúncio');
    if(SHOTS){mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:SHOTS+'/decisoes-'+id.toLowerCase()+'-7dias.png',fullPage:true});}
  }
  assert.equal(sim.calls.every(c=>c.method==='GET'),true);
  assert.equal(sim.calls.some(c=>/TODAS/.test(JSON.stringify(c.query))),false);
  assert.deepEqual(errors,[]);await context.close();
});

test('detalhe: fatos, hipóteses, indisponível e o que conferir; situação com data; sem afirmar estoque ou preço',async b=>{
  const {page,context}=await open(b);await ready(page,'SHOPEE');
  await page.getByRole('button',{name:/Caderno Shopee 1$/}).click();
  const d=await page.locator('[data-testid="detail-S1"]').innerText();
  assert.match(d,/Fatos/);assert.match(d,/Hipóteses/);assert.match(d,/Indisponível/);assert.match(d,/O que conferir/);
  assert.match(d,/Último estado cadastrado: ACTIVE, verificado em 2026-11-17/);
  assert.match(d,/Estoque: indisponível/);assert.match(d,/Preço: indisponível/);
  assert.doesNotMatch(d,/sem estoque|estoque baixo|preço (alto|baixo)/i);
  if(SHOTS)await page.screenshot({path:SHOTS+'/decisoes-shopee-detalhe.png',fullPage:true});
  await page.locator('[data-tier="hipotese_conversao"]').click();
  await page.getByRole('button',{name:/Caderno Shopee 8$/}).click();
  const h=await page.locator('[data-testid="detail-S8"]').innerText();
  assert.match(h,/pode indicar problema de conversão/);
  assert.match(h,/hipótese, não um fato/);
  assert.doesNotMatch(h,/projeç|vai vender|venderia|\+\d+ un por/i);
  await context.close();
});

test('troca rápida de conta: resposta lenta da conta anterior nunca aparece na atual',async b=>{
  const sim=createSimulator();sim.hold('SHOPEE',7);
  const {page,context,errors}=await open(b,{sim});
  await pick(page,'ML_ANTIGO').click();await pick(page,'ML_NOVO').click();
  await ready(page,'ML_NOVO');
  sim.release('SHOPEE',7);await page.waitForTimeout(400);
  const t=await body(page);assert.match(t,/Caderno ML Novo/);assert.doesNotMatch(t,/Caderno Shopee|Caderno ML Antigo/);
  assert.deepEqual(errors,[]);await context.close();
});

test('troca rápida de período: resposta de 7 dias não aparece sob 30 dias',async b=>{
  const sim=createSimulator();sim.hold('SHOPEE',7);
  const {page,context}=await open(b,{sim});
  await page.locator('[aria-label="Período"] button',{hasText:'30 dias'}).click();
  await ready(page,'SHOPEE');
  sim.release('SHOPEE',7);await page.waitForTimeout(400);
  assert.match(await body(page),/Anterior: 2026-09-25/);
  await context.close();
});

test('períodos não comprovados: nada confirmado, aviso essencial visível e tudo em dados insuficientes',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={proven:false};
  const {page,context}=await open(b,{sim});await page.waitForSelector('[data-testid="count-alta"]');
  assert.equal(await page.locator('[data-testid="count-alta"]').innerText(),'0');
  assert.equal(await page.locator('[data-testid="count-oportunidade"]').innerText(),'0');
  assert.ok(Number(await page.locator('[data-testid="count-insuficiente"]').innerText())>=5);
  assert.match(await page.locator('[data-testid="notice-PERIODO_ATUAL_NAO_COMPROVADO"]').innerText(),/não está comprovada/);
  await page.locator('[data-tier="insuficiente"]').click();
  assert.match(await body(page),/Possível queda, não confirmada/);
  assert.doesNotMatch(await body(page),/Parou de vender: /);
  await context.close();
});

test('item 4: período anterior não comprovado: perda não é confirmada e a ausência atual comprovada aparece como fato separado',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={prevUnproven:true};
  const {page,context}=await open(b,{sim});await page.waitForSelector('[data-testid="count-alta"]');
  assert.equal(await page.locator('[data-testid="count-alta"]').innerText(),'0'); assert.equal(await page.locator('[data-testid="count-sem_prioridade"]').innerText(),'0');
  assert.match(await page.locator('[data-testid="notice-PERIODO_ANTERIOR_NAO_COMPROVADO"]').innerText(),/nenhuma perda ou ganho/);
  assert.match(await page.locator('[data-testid="proven-absence"]').innerText(),/sem vendas no período atual.*não é confirmado/);
  await page.locator('[data-tier="insuficiente"]').click();
  assert.match(await body(page),/Ausência de vendas no período atual comprovada/);
  assert.doesNotMatch(await body(page),/Parou de vender: /);
  await context.close();
});

test('item 5: divergência com o Dashboard bloqueia classificações confirmadas e mostra o motivo',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={diverge:true};
  const {page,context}=await open(b,{sim});await page.waitForSelector('[data-testid="count-alta"]');
  for(const t of ['alta','revisao','oportunidade','sem_prioridade'])assert.equal(await page.locator('[data-testid="count-'+t+'"]').innerText(),'0',t);
  assert.match(await page.locator('[data-testid="notice-UNIDADES_DIVERGENTES"]').innerText(),/bloqueadas/);
  assert.ok(Number(await page.locator('[data-testid="count-insuficiente"]').innerText())>=5);
  await page.locator('details.ndc-recon summary').click();
  assert.match(await page.locator('[data-testid="recon-dashboard"]').innerText(),/divergente/);
  assert.match(await page.locator('[data-testid="recon-breakdown"]').innerText(),/sem ID de anúncio.*sem cadastro.*resíduo/);
  await context.close();
});

test('falha parcial: unidades indisponíveis não viram lista vazia',async b=>{
  const sim=createSimulator();sim.opts.mode.ML_NOVO={failUnits:true};
  const {page,context}=await open(b,{sim});await pick(page,'ML_NOVO').click();
  await page.waitForSelector('[data-testid="parts-down"]');
  assert.match(await page.locator('[data-testid="parts-down"]').innerText(),/unidades por anúncio/);
  assert.match(await body(page),/Nenhuma lista foi montada/);
  assert.equal(await page.locator('[data-testid="count-alta"]').count(),0);
  await context.close();
});

test('resposta de outra conta ou de outros dias é descartada',async b=>{
  for(const mode of [{wrongPlatform:true},{wrongDays:true}]){
    const sim=createSimulator();sim.opts.mode.SHOPEE=mode;
    const {page,context}=await open(b,{sim});
    await page.waitForSelector('.ndc-error[role="alert"]');
    assert.match(await body(page),/foi descartada/);
    assert.equal(await page.locator('[data-testid="count-alta"]').count(),0);
    await context.close();
  }
});

test('lista longa: 50 exibidos, total completo e aviso do limite',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={many:true};
  const {page,context}=await open(b,{sim});await ready(page,'SHOPEE');
  assert.equal(await page.locator('[data-testid="count-alta"]').innerText(),'62');
  assert.equal(await page.locator('.ndc-row').count(),50);
  assert.match(await page.locator('[data-testid="limit-note"]').innerText(),/50 de 62/);
  await context.close();
});

test('erro do servidor: mensagem clara e botão recupera',async b=>{
  const sim=createSimulator();sim.opts.fail.ML_NOVO=true;
  const {page,context}=await open(b,{sim});await pick(page,'ML_NOVO').click();
  await page.waitForSelector('.ndc-error[role="alert"]');
  sim.opts.fail.ML_NOVO=false;
  await page.getByRole('button',{name:'Tentar de novo'}).click();await ready(page,'ML_NOVO');
  await context.close();
});

test('celular: sem rolagem horizontal da página',async b=>{
  const {page,context}=await open(b,{viewport:{width:390,height:844}});await ready(page,'SHOPEE');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
  if(SHOTS)await page.screenshot({path:SHOTS+'/decisoes-shopee-celular.png',fullPage:true});
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
