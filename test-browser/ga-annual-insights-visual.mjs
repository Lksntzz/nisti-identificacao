// Prévia visual real do GA usando Chromium + Vite local e dados 100% sintéticos.
// Nunca acessa o Supabase, Worker ou qualquer ambiente de produção.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE='http://127.0.0.1:4173/ga-preview';
const DEST='artifacts/ga-annual';
const baseUnits=[420,350,480,510,540,580,620,700,710,690,200,750];
const currentUnits=[470,400,420,550,500,500,560,580,640,630,180,null];
const names=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function insights(url){
  const month=Number(url.searchParams.get('month')||1);
  const listing=url.searchParams.get('listing');
  const pairs=[
    {id:'1234567890',platform:'SHOPEE',title:'Planner Financeiro Permanente · Modelo Executivo',base:80,cur:0},
    {id:'2345678901',platform:'SHOPEE',title:'Devocional Diário · Edição Especial',base:68,cur:20},
    {id:'3456789012',platform:'SHOPEE',title:'Caderneta de Vacinação · Coleção Infantil',base:42,cur:70},
    {id:'4567890123',platform:'SHOPEE',title:'Controle de Caixa · Linha Profissional',base:31,cur:21}
  ];
  const august=[
    {id:'1234567890',platform:'SHOPEE',title:'Planner Financeiro Permanente · Modelo Executivo',base:170,cur:0},
    {id:'2345678901',platform:'SHOPEE',title:'Devocional Diário · Edição Especial',base:140,cur:60},
    {id:'3456789012',platform:'SHOPEE',title:'Caderneta de Vacinação · Coleção Infantil',base:110,cur:150},
    {id:'4567890123',platform:'SHOPEE',title:'Controle de Caixa · Linha Profissional',base:95,cur:125}
  ];
  const focus=month===8?august:pairs;
  return {
    year:2026,base_year:2025,as_of:'2026-11-02',last_sale:'2026-11-02',current_month:11,
    base_available:true,current_available:true,old_count:312,min_units:Number(url.searchParams.get('min')||20),
    annual:{base:5800,cur:5430,falling_ads:47,stopped_ads:7},
    new_ads:{count:35,units:900},
    months:names.map((name,i)=>({
      m:i+1,future:i===11,base_units:baseUnits[i],cur_units:currentUnits[i],
      base_strong:[28,25,32,37,40,42,45,49,47,44,20,51][i],
      kept:i===11?0:[16,17,21,25,28,27,31,24,30,29,8][i],
      lost:i===11?0:[12,8,11,12,12,15,14,25,17,15,12][i],
      recovered:3,falling:14,stopped:i===11?0:4,new_strong:i===11?0:5
    })),
    focus_month:month,focus_ads:focus,
    listing_months:listing?names.map((_,i)=>({m:i+1,base:[20,30,40,70,80,120,150,170,120,110,80,130][i],cur:i===11?null:[18,32,38,40,44,50,30,0,28,12,0][i]})):[]
  };
}
async function run(){
  await mkdir(DEST,{recursive:true});
  const browser=await chromium.launch({headless:true});
  try{
    for(const [label,viewport] of [
      ['desktop',{width:1440,height:900}],
      ['mobile-390',{width:390,height:844}]
    ]){
      const context=await browser.newContext({viewport,deviceScaleFactor:1,locale:'pt-BR',timezoneId:'America/Sao_Paulo',serviceWorkers:'block'});
      await context.route('**/api/**',route=>{
        const url=new URL(route.request().url());
        const data=url.pathname.endsWith('/sales-compare/annual-listing-insights')?insights(url):
          url.pathname.endsWith('/sales-compare/annual')?{platform:'SHOPEE',year:2026,base_year:2025,as_of:'2026-11-02',periods:[],coverage:[{year:2025,platform:'SHOPEE',units:5800},{year:2026,platform:'SHOPEE',units:5430}],kpi:{cur:5430,base:5800}}:{};
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
      });
      await context.route(/^https:\/\//,route=>route.abort());
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(BASE,{waitUntil:'domcontentloaded'});
      if(label==='mobile-390')await page.getByRole('button',{name:'Alternar menu lateral'}).click();
      await page.getByRole('button',{name:'Comparação anual'}).click();
      await page.locator('.gai-root').waitFor({timeout:30000});
      await page.getByText('Total inclui 35 anúncios novos (900 un.). A comparação por anúncio usa só os históricos.').waitFor({timeout:20000});
      await page.locator('.gai-chart:not(.compact) .gai-bar-month').nth(7).click(); // Agosto
      await page.getByText('Agosto · anúncios com histórico').waitFor();
      await page.locator('.gai-listing-card').first().click();
      await page.locator('.gai-chart.compact .gai-bar-month').first().waitFor({timeout:20000});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
      assert.ok(overflow<=1,'rolagem lateral indevida em '+label+': '+overflow+'px');
      assert.deepEqual(errors,[],'erros JS em '+label);
      await page.screenshot({path:DEST+'/ga-annual-'+label+'.png',fullPage:true,animations:'disabled'});
      if(label==='desktop'){
        const theme=page.getByRole('button',{name:'Ativar modo noturno'});
        if(await theme.count()){
          await theme.click();
          await page.screenshot({path:DEST+'/ga-annual-dark.png',fullPage:true,animations:'disabled'});
        }
      }
      console.log('OK: '+label+' · 12 meses, cartões e histórico do anúncio testados');
      await context.close();
    }
  }finally{await browser.close();}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
