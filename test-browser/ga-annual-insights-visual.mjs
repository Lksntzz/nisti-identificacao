// Prévia visual real da Comparação anual por famílias usando Chromium + dados 100% sintéticos.
// Nunca acessa o Supabase, Worker ou qualquer ambiente de produção.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE='http://127.0.0.1:4173/ga-preview';
const DEST='artifacts/ga-annual';
const baseUnits=[80,60,50,70,40,0,0,0,0,0,null,null];
const currentUnits=[120,110,80,100,90,0,0,0,0,0,null,null];
const family={id:10,name:'Agenda diária A5',model_name:'Agenda diária',format_name:'A5',category:'AGENDAS',category_id:1,category_name:'AGENDAS',member_count:2,base_units:300,cur_units:500,cur_revenue:15000};
const catalog={
  families:[family],categories:[{id:1,name:'AGENDAS'}],
  members:[{family_id:10,product_id:101,name:'Agenda Floral',edition_year:2026}],candidates:[]
};
const report={
  year:2026,base_year:2025,as_of:'2026-10-31',base_available:true,current_available:true,
  platforms_not_comparable:[],platform_coverage:[],
  overall:{unclassified_cur_units:480,without_family_cur_units:400,unmapped_cur_units:80},
  families:[family],
  months:baseUnits.map((base_units,i)=>({
    month:i+1,base_units,cur_units:currentUnits[i],
    base_revenue:base_units==null?null:base_units*30,
    cur_revenue:currentUnits[i]==null?null:currentUnits[i]*30
  })),
  details:[
    {month:1,product_id:101,product_name:'Agenda Floral',edition_year:2026,sku:'AGENDA-FLOR-2026',platform:'SHOPEE',listing_id:'1234567890',base_units:80,cur_units:120,cur_revenue:3600},
    {month:1,product_id:102,product_name:'Agenda Lisa',edition_year:2025,sku:'AGENDA-LISA-2025',platform:'SHOPEE',listing_id:'2345678901',base_units:0,cur_units:40,cur_revenue:1200}
  ]
};
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
        const data=url.pathname.endsWith('/sales-compare/families/catalog')?catalog:
          url.pathname.endsWith('/sales-compare/families/report')?report:{};
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
      });
      await context.route(/^https:\/\//,route=>route.abort());
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(BASE,{waitUntil:'domcontentloaded'});
      if(label==='mobile-390')await page.getByRole('button',{name:'Alternar menu lateral'}).click();
      await page.getByRole('button',{name:'Comparação anual'}).click();
      await page.locator('.gaf-root').waitFor({timeout:30000});
      await page.getByRole('heading',{name:'Comparação anual · Famílias e edições'}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Famílias e edições',exact:true}).count(),0,'submenu duplicado em '+label);
      await page.getByText('Das vendas de 2026, 480 unidades ainda estão fora das famílias:').waitFor({timeout:20000});
      await page.locator('.gaf-filters select').nth(2).selectOption('10');
      await page.getByText('AGENDA-FLOR-2026').waitFor();
      await page.getByLabel('Período do detalhe').selectOption('1');
      await page.getByText('AGENDA-LISA-2025').waitFor();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
      assert.ok(overflow<=1,'rolagem lateral indevida em '+label+': '+overflow+'px');
      assert.deepEqual(errors,[],'erros JS em '+label);
      await page.screenshot({path:DEST+'/ga-annual-'+label+'.png',fullPage:true,animations:'disabled'});
      if(label==='desktop'){
        await page.getByRole('button',{name:'Gerenciar famílias'}).click();
        await page.getByRole('heading',{name:'Cadastro e revisão de famílias'}).waitFor();
        await page.screenshot({path:DEST+'/ga-annual-registry.png',fullPage:true,animations:'disabled'});
        const theme=page.getByRole('button',{name:'Ativar modo noturno'});
        if(await theme.count()){
          await theme.click();
          await page.screenshot({path:DEST+'/ga-annual-dark.png',fullPage:true,animations:'disabled'});
        }
      }
      console.log('OK: '+label+' · 12 meses, famílias, capas, SKUs e cadastro testados');
      await context.close();
    }
  }finally{await browser.close();}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
