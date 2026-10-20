import {chromium} from 'playwright';
const targets=['https://admin.sistemanistiid.online/monitor-notificacoes', 'https://nisti-identificacao.lksntz1411.workers.dev/monitor-notificacoes'];
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
let failed=false;
try{
  for(const target of targets){
    const context=await browser.newContext({serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',err=>errors.push('JS '+err.message));
    page.on('console',msg=>{if(msg.type()==='error')errors.push('console '+msg.text())});
    page.on('requestfailed',req=>errors.push('request '+req.url()+' '+req.failure()?.errorText));
    const response=await page.goto(target,{waitUntil:'networkidle',timeout:40000}).catch(error=>{errors.push('goto '+error.message);return null});
    await page.waitForTimeout(4000);
    const snapshot=await page.evaluate(()=>({title:document.title,rootText:document.getElementById('root')?.innerText?.slice(0,650),bodyText:document.body.innerText.slice(0,650),hasMonitor:Boolean(document.querySelector('.nid-monitor')),scripts:[...document.scripts].map(s=>s.src)})).catch(e=>({error:e.message}));
    console.log(JSON.stringify({target,status:response?.status(),snapshot,errors},null,2));
    if(!snapshot?.hasMonitor) failed=true;
    await context.close();
  }
}finally{await browser.close()}
if(failed){process.exitCode=1;}
