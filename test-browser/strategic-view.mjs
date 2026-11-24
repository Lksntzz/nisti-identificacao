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
  previous_start:days===7?'2026-11-10':'2026-09-25',totals:{cur_units:UNITS[platform],prev_units:UNITS[platform]-20,cur_rev:1,prev_rev:1,listings:25},
  drops:{total:57,items:[{listing_id:2,platform,external_id:'B2',title:'Capa Floral '+NAME[platform],units:2,units_previous:10}]},...over});
const addDay=(iso,n)=>new Date(Date.parse(iso)+n*864e5).toISOString().slice(0,10);
const dqGap=(platform,start,end,days)=>({platform,period:{start,end},sales:{status:'PARCIAL',requested_days:Math.round((Date.parse(end)-Date.parse(start))/864e5)+1,complete_days:Math.round((Date.parse(end)-Date.parse(start))/864e5)+1-days.length,
  partial_days:0,days_without_information:days.length,days_with_records_unverified:0,missing_ranges:days.map(d=>({start:d,end:d,days:1}))}});
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
      no_sales:[{listing_id:4,platform,external_id:'D4',title:'Anúncio Sem Venda',units_ever:0,last_sale:null}],no_sales_never:9,unlinked:{listings:2},
      window_days_with_sales:days,coverage:[{platform,first_day:'2025-01-01',last_day:'2026-11-23',last_import:'2026-11-24T10:00:00Z'}]},
    monthly:{months:[['2026-08',50],['2026-10',120],['2026-11',90]].map(([month,u])=>({month:month+'-01',['units_'+({SHOPEE:'shopee',ML_ANTIGO:'ml_antigo',ML_NOVO:'ml_novo'}[platform])]:u,days_with_sales:20}))},
    series:{platform,days,daily:Array.from({length:days},(_,i)=>({day:new Date(Date.parse(cur.start)+i*86400000).toISOString().slice(0,10),['units_'+({SHOPEE:'shopee',ML_ANTIGO:'ml_antigo',ML_NOVO:'ml_novo'}[platform])]:(over.gaps&&(i===3||i===4))?0:10+i,['prev_units_'+({SHOPEE:'shopee',ML_ANTIGO:'ml_antigo',ML_NOVO:'ml_novo'}[platform])]:8+(i%3)*2}))},
    categories:failed.includes('categories')?null:{platform,cur_from:cur.start,cur_to:cur.end,base_from:'2025'+cur.start.slice(4),base_to:'2025'+cur.end.slice(4),
      total:{cur:UNITS[platform],base:90},categories:[{name:'Agendas',cur:90,base:60,cols:[{name:'Floral',cur:50,base:30}]}]},
    split:platform==='SHOPEE'?{status:'COMPLETO',total_units:UNITS[platform]+5,linked_units:UNITS[platform],unlinked_units:5,base_units:UNITS[platform],
      difference:{units:-5,other_explained_units:0,residual_units:0},reconciliation:{status:'EXPLICADA'},coverage:{missing_days:0}}:null,
    dqCurrent:over.gaps?dqGap(platform,cur.start,cur.end,[addDay(cur.start,3),addDay(cur.start,4)]):proven?dq(platform,cur.start,cur.end):dq(platform,cur.start,cur.end,false),
    dqPrevious:over.gaps?dqGap(platform,prev.start,prev.end,[addDay(prev.start,2)]):prevOk?dq(platform,prev.start,prev.end):dq(platform,prev.start,prev.end,false),
    dqHistory:dq(platform,hist.start,hist.end,false),dqCurrentRanges:null,dqCatBase:dq(platform,'2025'+cur.start.slice(4),'2025'+cur.end.slice(4)),
    perf:platform==='SHOPEE'?{shopee:{reports:[{start:'2026-11-01',end:'2026-11-14'}],items:{A1:{visits:700,impressions:9000,conversion_pct:1.4}}},ml:{reports:[],items:{}}}
      :{shopee:{reports:[],items:{}},ml:{reports:[{account:platform==='ML_NOVO'?'NOVO':'ANTIGO',start:'2026-11-01',end:'2026-11-14'}],items:{A1:{account:platform==='ML_NOVO'?'NOVO':'ANTIGO',visits:300,conversion_pct:2.1}}}},...over.parts});
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
    assert.match(t,/Atual: 2026-11-17 a 2026-11-23/);
    await page.getByRole('tab',{name:'Categorias'}).click();
    assert.match(await body(page),/Comparação anual/);
    await page.getByRole('tab',{name:'Anúncios',exact:true}).click();
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
  const chips=await page.locator('.nsv-chip span').allInnerTexts();
  assert.deepEqual(chips.map(x=>x.trim().toLowerCase()),['possível crescimento','possível queda','possíveis parados','sem vendas registradas']);
  let t=await body(page);
  assert.match(t,/Possíveis quedas \(não confirmadas\)/);assert.match(t,/57 possíveis quedas/);assert.match(t,/Candidatos pelos dados importados/);
  await page.locator('[data-group="growth"]').click();
  assert.match(await body(page),/Possível crescimento \(não confirmado\)/);
  await page.locator('[data-group="stopped"]').click();
  assert.match(await body(page),/Possíveis parados \(não confirmados\)/);
  await page.locator('[data-group="never"]').click();
  assert.match(await body(page),/Sem venda nos dados importados \(histórico não verificado\)/);
  assert.match(await page.locator('.nsv-kpis').innerText(),/—/);
  assert.match(t,/não verificado/);
  if(SHOTS)await page.screenshot({path:SHOTS+'/shopee-30dias-nao-comprovado.png',fullPage:true});
  await context.close();
});

test('período comprovado: títulos confirmados e histórico importado identificado',async b=>{
  const {page,context}=await open(b);
  await page.waitForSelector('[data-testid="units-current"]');
  const t=await body(page);
  assert.equal((await page.locator('.nsv-chip span').allInnerTexts()).map(x=>x.trim())[1],'Queda');
  assert.match(t,/57 anúncios em queda/);
  await page.locator('[data-group="never"]').click();
  assert.match(await body(page),/Sem venda nos dados importados \(histórico não verificado\)/); // histórico fictício parcial
  assert.doesNotMatch(t,/nunca vendeu|nunca venderam/i);
  assert.match(t,/Outra base, não somar: total por SKU/);
  assert.match(t,/vendas dos anúncios vinculados/);
  await context.close();
});

test('cobertura não comprovada: cartão, campeões e evolução não transmitem certeza de ausência',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={proven:false,prevOk:false};
  const {page,context}=await open(b,{sim});
  await page.waitForSelector('[data-testid="units-current"]');
  assert.match(await page.locator('[data-testid="no-sales-card"]').evaluate(e=>e.textContent),/sem venda nos dados importados \(cobertura não comprovada\)/);
  const t=await body(page);
  assert.match(t,/a cobertura do período atual não comprovada pode alterar a ordem/);
  assert.match(await page.locator('[data-testid="daily-note"]').evaluate(e=>e.textContent),/não provam ausência de vendas/);
  assert.ok(await page.locator('circle.nsv-dot.hollow').count()>0,'pontos não verificados ficam vazados');
  await page.getByRole('tab',{name:'Mensal'}).click();
  assert.match(await page.locator('[data-testid="months-note"]').evaluate(e=>e.textContent),/não prova ausência de vendas/);
  await page.getByRole('tab',{name:'Diária'}).click();
  assert.match(await page.locator('[data-testid="limitations"]').evaluate(e=>e.textContent),/Conferência de origem limitada/);
  if(SHOTS)await page.screenshot({path:SHOTS+'/shopee-cobertura-nao-comprovada.png',fullPage:true});
  await context.close();
});

test('cinco áreas na ordem, filtros e qualidade expansível com avisos essenciais visíveis',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={proven:false,prevOk:false};
  const {page,context}=await open(b,{sim});
  await page.waitForSelector('[data-testid="units-current"]');
  const heads=(await page.locator('.nsv-sec h2').allTextContents()).map(x=>x.replace(/^\d/,'').trim());
  assert.deepEqual(heads,['Resumo comercial','Situação dos anúncios','Evolução comercial','Desempenho dos anúncios, categorias e coleções','Qualidade e conciliação']);
  // aviso essencial visível com a seção de qualidade fechada
  assert.equal(await page.locator('details[open]').count(),0);
  assert.equal(await page.locator('.nsv-alerts [data-notice="PERIODO_ATUAL_NAO_COMPROVADO"]').isVisible(),true);
  assert.equal(await page.locator('[data-testid="quality-body"]').isVisible(),false);
  await page.locator('.nsv-quality summary').click();
  assert.equal(await page.locator('[data-testid="quality-body"]').isVisible(),true);
  assert.match(await page.locator('[data-testid="quality-body"]').innerText(),/Cobertura de vendas/);
  // filtro de busca
  await page.locator('[data-group="drops"]').click();
  await page.getByPlaceholder('título ou código').fill('zzz-inexistente');
  assert.match(await body(page),/Nenhum anúncio corresponde à busca/);
  await page.getByPlaceholder('título ou código').fill('B2');
  assert.equal(await page.locator('.nsv-sec').nth(1).locator('tbody tr').count(),1);
  // total do grupo continua vindo da fonte (57), nunca da busca
  assert.match(await page.locator('[data-group="drops"]').innerText(),/57/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
  await context.close();
});

test('gráfico: diário e mensal, dica ao passar o mouse e tabela dos valores',async b=>{
  const {page,context}=await open(b);
  await page.waitForSelector('[data-testid="units-current"]');
  assert.equal(await page.locator('.nsv-chart svg path.nsv-line.cur').count(),1);
  assert.equal(await page.locator('.nsv-chart svg path.nsv-line.prev').count(),1);
  assert.match(await page.locator('.nsv-legend').innerText(),/Período atual[\s\S]*Período anterior/);
  const box=await page.locator('.nsv-chart svg').boundingBox();
  await page.mouse.move(box.x+box.width*0.5,box.y+box.height*0.5);
  await page.waitForSelector('.nsv-tip');
  assert.match(await page.locator('.nsv-tip').innerText(),/Período atual: \d+/);
  await page.getByRole('tab',{name:'Mensal'}).click();
  assert.ok(await page.locator('.nsv-chart svg rect.nsv-bar.cur').count()>=1);
  assert.match(await page.locator('.nsv-legend').innerText(),/Mês anterior/);
  await page.locator('summary',{hasText:'Ver tabela dos valores'}).click();
  assert.ok(await page.locator('.nsv-sec').nth(2).locator('tbody tr').count()>=1);
  if(SHOTS){await page.getByRole('tab',{name:'Diária'}).click();await page.locator('.nsv-quality summary').click();await page.screenshot({path:SHOTS+'/shopee-qualidade-aberta.png',fullPage:true});}
  await context.close();
});

test('lacunas: dia sem informação nunca vira zero, anterior tem cobertura própria e datas dos relatórios aparecem',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={over:{gaps:true}};
  const {page,context}=await open(b,{sim});
  await page.waitForSelector('[data-testid="units-current"]');
  assert.equal(await page.locator('rect.nsv-gap').count(),2,'duas lacunas no período atual');
  assert.equal(await page.locator('text.nsv-pgap').count(),1,'uma lacuna no período anterior, marcada à parte');
  assert.equal(await page.locator('circle.nsv-dot:not(.prev)').count(),5,'os dois dias sem informação não são desenhados (nem como zero)');
  assert.match(await page.locator('.nsv-legend').innerText(),/sem informação \(lacuna, não é zero\)/);
  const box=await page.locator('.nsv-chart svg').boundingBox();
  await page.mouse.move(box.x+box.width*(3/6),box.y+box.height*0.5);
  const tip=await page.locator('.nsv-tip').innerText();
  assert.match(tip,/Período atual: sem informação/);assert.doesNotMatch(tip,/Período atual: 0/);
  await page.locator('summary',{hasText:'Ver tabela dos valores'}).click();
  const t=await page.locator('[data-testid="evo-table-daily"]').innerText();
  assert.match(t,/sem informação/);assert.match(t,/Cobertura do anterior/);assert.doesNotMatch(t,/\n2026-11-20\t0\t/);
  const rows=await page.locator('[data-testid="evo-table-daily"] tbody tr').allInnerTexts();
  assert.match(rows[3],/sem informação/);assert.doesNotMatch(rows[3].split('\t')[1],/^0$/);
  if(SHOTS)await page.screenshot({path:SHOTS+'/shopee-lacunas.png',fullPage:true});
  await context.close();
});

test('mensal: mês anterior de calendário, mês ausente e mês incompleto identificados',async b=>{
  const {page,context}=await open(b);
  await page.waitForSelector('[data-testid="units-current"]');
  await page.getByRole('tab',{name:'Mensal'}).click();
  assert.match(await page.locator('.nsv-legend').innerText(),/\*\s*mês incompleto/);
  await page.locator('summary',{hasText:'Ver tabela dos valores'}).click();
  const rows=await page.locator('[data-testid="evo-table-monthly"] tbody tr').allInnerTexts();
  const oct=rows.find(r=>r.startsWith('2026-10')),nov=rows.find(r=>r.startsWith('2026-11'));
  assert.match(oct,/2026-09[\s\S]*ausente da série/);
  assert.match(nov,/incompleto \(até 2026-11-23\)/);assert.match(nov,/2026-10/);
  assert.match(await page.locator('.nsv-chart svg').innerHTML(),/2026-11|11\/26\*/);
  if(SHOTS)await page.screenshot({path:SHOTS+'/shopee-mensal.png',fullPage:true});
  await context.close();
});

test('relatórios de visitas: datas aparecem; período anterior em #64748b tracejado e atual em #2a78d6; anúncios com vendas explica a base',async b=>{
  const {page,context}=await open(b);
  await page.waitForSelector('[data-testid="units-current"]');
  const per=await page.locator('[data-testid="traffic-period"]').first().innerText();
  assert.match(per,/relatório de 2026-11-01 a 2026-11-14/);
  await page.getByRole('tab',{name:'Anúncios',exact:true}).click();
  assert.match(await page.locator('.nsv-sec').nth(3).locator('[data-testid="traffic-period"]').first().innerText(),/2026-11-01 a 2026-11-14/);
  const st=await page.evaluate(()=>{const q=s=>getComputedStyle(document.querySelector(s));
    return {prev:q('.nsv-line.prev').stroke,dash:q('.nsv-line.prev').strokeDasharray,cur:q('.nsv-line.cur').stroke};});
  assert.equal(st.prev,'rgb(100, 116, 139)');assert.notEqual(st.dash,'none');assert.equal(st.cur,'rgb(42, 120, 214)');
  assert.equal(await page.locator('[data-testid="with-sales-value"]').innerText(),'25');
  assert.match(await page.locator('[data-testid="with-sales-note"]').innerText(),/inclui anúncios inativos/);
  await context.close();
});

test('falhas parciais: indisponível não vira lista vazia e o resto continua',async b=>{
  const sim=createSimulator();sim.opts.mode.SHOPEE={failed:['overview','categories']};
  const {page,context}=await open(b,{sim});
  await page.waitForSelector('[data-testid="units-current"]');
  const t=await body(page);
  assert.match(t,/Partes indisponíveis ou descartadas/);
  await page.locator('[data-group="stopped"]').click();
  const panel=await body(page);
  assert.match(panel,/Consulta indisponível no momento/);assert.doesNotMatch(panel.split('Evolução comercial')[0].split('Situação dos anúncios')[1],/Nenhum anúncio nesta lista/);
  await page.getByRole('tab',{name:'Categorias'}).click();
  assert.match(await body(page),/Categorias indisponíveis no momento/);
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
