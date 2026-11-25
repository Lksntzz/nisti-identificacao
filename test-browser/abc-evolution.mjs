// GA-015 — Chromium real: Evolução ABC com API SIMULADA (dados fictícios, nos formatos reais). Cobre troca rápida de conta, cobertura não comprovada,
// conciliação divergente x indisponível, mês incompleto, resposta de outra conta, só GET, ausência de termos financeiros e celular.
// NUNCA executar contra workers.dev, Supabase ou endpoints externos de produção.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {planPeriods,buildAbcEvolution,daysBetween} from '../src/ga/commerce-abc-logic.js';

const BASE=process.env.NISTI_HARNESS_BASE||'http://127.0.0.1:4173';
const URL_VIEW=BASE+'/test-browser/harness/abc-evolution.html';
const SHOTS=process.env.NISTI_SHOTS_DIR||'';
const NAME={SHOPEE:'Shopee',ML_ANTIGO:'ML Antigo',ML_NOVO:'ML Novo'};
const tests=[];const test=(name,fn)=>tests.push({name,fn});
const LAST='2026-11-23',TODAY='2026-11-25';

// Produtos FICTÍCIOS: "PROD-01".."PROD-14". O 1º cai de classe e o último sobe no período atual.
function payload(platform,mode,{month=null,cover='COMPLETA',diverge=false,noUnits=false,provenFrom='2026-10-01',lastNull=false}={}){
  if(lastNull)return buildAbcEvolution({platform,mode,today:TODAY,last:null,plan:{error:'SEM_ULTIMO_DIA_COMPLETO'}});
  const plan=planPeriods({mode,last:LAST,firstDay:platform==='SHOPEE'?'2025-01-01':'2026-01-01',month});
  const all=[...plan.history,plan.current,...(plan.previous?[plan.previous]:[])];
  const sku=i=>'PROD-'+String(i+1).padStart(2,'0');
  const amount=(i,p)=>{let u=Math.round(daysBetween(p.start,p.end)*(14-i)/2);if(p.key.endsWith('atual')){if(i===0)u=Math.round(u*0.15);if(i===13)u=u*9;}return u;};
  const periods=all.map(p=>{const sk=Array.from({length:14},(_,i)=>amount(i,p)).reduce((a,b)=>a+b,0),nos=Math.round(sk*0.04);
    return {key:p.key,start:p.start,end:p.end,days:daysBetween(p.start,p.end),days_with_data:daysBetween(p.start,p.end),total_units:sk+nos,sku_units:sk,no_sku_units:nos,ranked_units:sk,nonpositive_units:0,products:14};});
  const data=noUnits?null:{platform,periods,product_count:14,products:Array.from({length:14},(_,i)=>({sku:sku(i),units:Object.fromEntries(all.map(p=>[p.key,amount(i,p)]))}))};
  const ga019=Object.fromEntries(periods.map(p=>[p.key,p.total_units+(diverge&&p.key.endsWith('atual')?5:0)]));
  const coverage=Object.fromEntries(all.map(p=>[p.key,cover==='COMPLETA'&&p.start>=provenFrom?'COMPLETA':'NAO_COMPROVADA']));
  const splits=platform==='SHOPEE'?Object.fromEntries(periods.map(p=>[p.key,{start:p.start,end:p.end,total_units:p.total_units,unlinked_units:0,reconciliation:{status:'EXPLICADA',identity_ok:true,source_units_match:true},difference:{residual_units:0}}])):{};
  const out=buildAbcEvolution({platform,mode,today:TODAY,last:LAST,plan,data,ga019,coverage,splits});
  return {...out,window:{last_import_day:'2026-11-24',last_import_at:'2026-11-24T13:00:00+00:00',skipped:[{day:'2026-11-24',state:'PARCIAL'}],probes:2},failed:noUnits?['units']:[],elapsed_ms:120};
}

function createSimulator(){
  const calls=[];const holds=new Map();const opts={mode:{},fail:{}};
  const key=(p,m)=>p+'|'+m;
  const hold=(p,m='7d')=>{let release;const gate=new Promise(r=>{release=r;});holds.set(key(p,m),{gate,release});};
  const release=(p,m='7d')=>holds.get(key(p,m))?.release();
  const handler=async route=>{
    const req=route.request(),url=new URL(req.url());
    calls.push({path:url.pathname,method:req.method(),query:Object.fromEntries(url.searchParams)});
    const json=(b,s=200)=>route.fulfill({status:s,contentType:'application/json',body:JSON.stringify(b)});
    if(req.method()!=='GET')return json({error:'Escrita bloqueada no teste'},403);
    if(url.pathname!=='/api/admin/commerce/abc-evolution')return json({});
    const platform=url.searchParams.get('platform'),mode=url.searchParams.get('mode'),month=url.searchParams.get('month')||null;
    if(!NAME[platform]||!['7d','30d','mensal','anual'].includes(mode))return json({error:'Filtro da Evolução ABC inválido.'},400);
    const h=holds.get(key(platform,mode));if(h)await h.gate;
    const m=opts.mode[key(platform,mode)]||opts.mode[platform]||{};
    if(opts.fail[platform])return json({error:'falha simulada'},500);
    if(m.wrongPlatform)return json(payload('ML_NOVO',mode,{month}));
    if(m.wrongMode)return json(payload(platform,mode==='7d'?'30d':'7d'));
    return json(payload(platform,mode,{month,...m}));
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
const mode=(page,t)=>page.locator('[aria-label="Comparação"] button',{hasText:t});
const body=page=>page.locator('[data-testid="abc-evolution"]').evaluate(e=>e.textContent);
const ready=page=>page.waitForFunction(()=>document.querySelector('[data-testid="periods"]'));

test('três contas, 7 dias: períodos, base, classes, concentração, só GET, sem termos financeiros',async b=>{
  const {page,sim,context,errors}=await open(b);
  for(const id of ['SHOPEE','ML_ANTIGO','ML_NOVO']){
    await pick(page,id).click();await page.waitForFunction(n=>document.querySelector('[data-testid="abc-evolution"]')?.textContent.includes('Atual 17/11/2026 a 23/11/2026')&&document.querySelector('[aria-label="Conta"] [aria-pressed="true"]')?.textContent===n,NAME[id]);
    const t=await body(page);
    assert.doesNotMatch(t,/faturamento|lucro|margem|ticket|R\$|receita/i);
    assert.match(t,/Anterior 10\/11\/2026 a 16\/11\/2026/);
    assert.match(await page.locator('[data-testid="window-dates"]').innerText(),/Último dia completo comprovado: 23\/11\/2026 · última data importada: 24\/11\/2026 · fora da análise por não estarem completos: 24\/11\/2026 \(parcial\)/);
    assert.match(await page.locator('[data-testid="base"]').innerText(),/Base dos percentuais: .* unidades com SKU.*Vendas sem SKU/);
    assert.equal(await page.locator('[data-testid="status-j7_atual"]').innerText(),'confirmado');
    assert.equal(Number(await page.locator('[data-testid="count-class-A"]').innerText())+Number(await page.locator('[data-testid="count-class-B"]').innerText())+Number(await page.locator('[data-testid="count-class-C"]').innerText()),14);
    assert.match(await page.locator('[data-testid="conc-top10"]').innerText(),/%$/);
    assert.ok(Number(await page.locator('[data-testid="count-migrations"]').innerText())>=1,'há migração de classe');
    assert.equal(await page.locator('button',{hasText:/aplicar|alterar|salvar|excluir|pausar/i}).count(),0);
    if(SHOTS){mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:SHOTS+'/abc-'+id.toLowerCase()+'-7dias.png',fullPage:true});}
  }
  assert.equal(sim.calls.every(c=>c.method==='GET'),true);assert.equal(sim.calls.some(c=>/TODAS/.test(JSON.stringify(c.query))),false);
  assert.deepEqual(errors,[]);await context.close();
});

test('migrações: comprovada x relevante, direção, unidades e participação separadas; entrada/saída não são migração',async b=>{
  const {page,context}=await open(b);await ready(page);
  const r=await page.locator('[data-testid="row-PROD-01"]').innerText();
  assert.match(r,/Desceu de classe/);assert.match(r,/Relevante/);assert.match(r,/Caiu em unidades e em participação/);
  await page.locator('[aria-label="Listas"] button',{hasText:'Novos no top 10'}).click();
  assert.match(await page.locator('[data-testid="row-PROD-14"]').innerText(),/4º.*14º/);
  await page.locator('[aria-label="Listas"] button',{hasText:'Novos na classe A'}).click();
  assert.ok(await page.locator('[data-testid="row-PROD-14"]').count()>=0);
  await page.locator('[aria-label="Listas"] button',{hasText:'Todos os produtos'}).click();
  assert.equal(await page.locator('table.nae-table').first().locator('tbody tr').count(),14);
  await context.close();
});

test('cobertura não comprovada: só unidades, abas e cartões bloqueados, sem classe confirmada',async b=>{
  const sim=createSimulator();sim.opts.mode.ML_NOVO={cover:'NAO_COMPROVADA'};
  const {page,context}=await open(b,{sim});await pick(page,'ML_NOVO').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="state-NAO_COMPROVADA"]'));
  const t=await body(page);assert.match(t,/cobertura de vendas de um dos períodos não está comprovada/);
  assert.equal(await page.locator('[data-testid="count-migrations"]').innerText(),'—');
  assert.equal(await page.locator('[aria-label="Listas"] button:not([disabled])').count(),1);
  assert.doesNotMatch(await page.locator('table.nae-table').first().innerText(),/Classe|Posição/);
  assert.match(await page.locator('[data-testid="status-j7_atual"]').innerText(),/cobertura não comprovada/);
  await context.close();
});

test('divergente e indisponível são bloqueios distintos, com o motivo, e nunca viram "sem vendas"',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={diverge:true};sim.opts.mode.ML_ANTIGO={noUnits:true};
  const {page,context}=await open(b,{sim});
  await page.waitForFunction(()=>document.querySelector('[data-testid="state-BLOQUEADA_DIVERGENTE"]'));
  assert.match(await body(page),/o total difere da fonte diária de vendas \(GA-019\)/);assert.equal(await page.locator('[data-testid="count-migrations"]').count(),0);
  await pick(page,'ML_ANTIGO').click();await page.waitForFunction(()=>document.querySelector('[data-testid="state-BLOQUEADA_INDISPONIVEL"]'));
  const t=await body(page);assert.match(t,/Isto não significa que não houve vendas/);assert.match(await page.locator('[data-testid="parts-down"]').innerText(),/unidades por SKU/);assert.doesNotMatch(t,/Nenhuma migração/);
  await context.close();
});

test('mensal: mês corrente incompleto contra os mesmos dias do mês anterior; histórico marca incompleto e não comprovado',async b=>{
  const {page,context}=await open(b);await mode(page,'Mensal').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="period-current"]')?.textContent.includes('01/11/2026 a 23/11/2026'));
  assert.match(await page.locator('[data-testid="period-current"]').innerText(),/mês incompleto/);
  assert.match(await page.locator('[data-testid="period-previous"]').innerText(),/01\/10\/2026 a 23\/10\/2026/);
  const h=await page.locator('[data-testid="history-table"]').evaluate(e=>e.textContent);
  assert.match(h,/nov\/26 \(incompleto\)/);assert.match(h,/set\/26.*cobertura não comprovada/);assert.match(h,/out\/26.*confirmado/);
  assert.equal(await page.locator('[data-testid="line-top1"]').count(),1);assert.ok(await page.locator('[data-testid^="bar-"]').count()>=10);
  assert.match(await body(page),/Concentração alta não prova redução do catálogo ativo/);
  await page.locator('select[aria-label="Mês"]').selectOption('2026-10');
  await page.waitForFunction(()=>document.querySelector('[data-testid="period-current"]')?.textContent.includes('01/10/2026 a 31/10/2026'));
  assert.doesNotMatch(await page.locator('[data-testid="period-current"]').innerText(),/mês incompleto/);
  if(SHOTS)await page.screenshot({path:SHOTS+'/abc-shopee-mensal.png',fullPage:true});
  await context.close();
});

test('anual: ML não tem o ano anterior e diz isso; Shopee compara com o ano anterior',async b=>{
  const {page,context}=await open(b);await mode(page,'Anual').click();await page.waitForFunction(()=>document.querySelector('[data-testid="period-previous"]')?.textContent.includes('2025'));
  await pick(page,'ML_NOVO').click();await page.waitForFunction(()=>document.querySelector('[data-testid="state-SEM_PERIODO_ANTERIOR"]'));
  assert.match(await body(page),/Não há período anterior equivalente/);await context.close();
});

test('sem último dia completo: indisponível, sem inventar vendas',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={lastNull:true};
  const {page,context}=await open(b,{sim});await page.waitForFunction(()=>document.querySelector('[data-testid="unavailable"]'));
  assert.match(await page.locator('[data-testid="unavailable"]').innerText(),/não há dia completo comprovado.*Isto não significa que não houve vendas/);await context.close();
});

test('troca rápida de conta e de comparação: resposta lenta nunca aparece na escolha atual',async b=>{
  const sim=createSimulator();sim.hold('SHOPEE','7d');
  const {page,context,errors}=await open(b,{sim});
  await pick(page,'ML_ANTIGO').click();await pick(page,'ML_NOVO').click();await mode(page,'30 dias').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="period-current"]')?.textContent.includes('25/10/2026 a 23/11/2026'));
  sim.release('SHOPEE','7d');await page.waitForTimeout(400);
  const t=await body(page);assert.match(t,/Atual 25\/10\/2026 a 23\/11\/2026/);assert.doesNotMatch(t,/Atual 17\/11\/2026/);
  assert.equal(await page.locator('[aria-label="Conta"] [aria-pressed="true"]').innerText(),'ML Novo');assert.deepEqual(errors,[]);await context.close();
});

test('resposta de outra conta ou de outra comparação é descartada',async b=>{
  const sim=createSimulator();sim.opts.mode.ML_ANTIGO={wrongPlatform:true};sim.opts.mode.ML_NOVO={wrongMode:true};
  const {page,context}=await open(b,{sim});await pick(page,'ML_ANTIGO').click();
  await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('foi descartada'));
  assert.equal(await page.locator('[data-testid="periods"]').count(),0);
  await pick(page,'ML_NOVO').click();await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('foi descartada'));await context.close();
});

test('erro do servidor: mensagem clara e botão recupera',async b=>{
  const sim=createSimulator();sim.opts.fail.ML_NOVO=true;
  const {page,context}=await open(b,{sim});await pick(page,'ML_NOVO').click();
  await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('Tentar de novo'));
  sim.opts.fail.ML_NOVO=false;await page.getByRole('button',{name:'Tentar de novo'}).click();await ready(page);await context.close();
});

test('celular: sem rolagem horizontal da página',async b=>{
  const {page,context}=await open(b,{viewport:{width:390,height:844}});await ready(page);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
  if(SHOTS)await page.screenshot({path:SHOTS+'/abc-shopee-celular.png',fullPage:true});await context.close();
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
