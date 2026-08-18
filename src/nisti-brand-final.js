import './nisti-brand-final.css';

const BRAND_VIEWS = {
  geral: ['Dashboard', 'Visão geral do catálogo e biblioteca de mockups.'],
  mockups: ['Mockups', 'Pesquise produtos, confira imagens e substitua mockups quando necessário.'],
  importacao: ['Importação', 'Atualize o catálogo por CSV ou cadastre um produto individualmente.'],
  administracao: ['Administração', 'Acompanhe banco de dados, armazenamento e uso do Gemini.']
};

let currentBrandView = 'geral';
let scheduled = false;

function isAdmin(){
  return document.documentElement.dataset.nistiAccess === 'admin';
}

function icon(name){
  const paths={
    home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/>',
    image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
    upload:'<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 15v4h16v-4"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.home}</svg>`;
}

function setVisible(el,visible){
  if(!el)return;
  el.hidden=!visible;
  el.classList.toggle('brand-visible',visible);
}

function ensureBrandHeader(){
  if(!isAdmin())return;
  const header=document.querySelector('main.shell > header');
  const nav=header?.querySelector('nav');
  if(!header||!nav)return;

  let brand=header.querySelector('.nisti-brand-real');
  if(!brand){
    brand=document.createElement('a');
    brand.className='nisti-brand-real';
    brand.href='/admin';
    brand.innerHTML='<img src="/nisti-logo.svg" alt="NISTI PRINT">';
    header.insertAdjacentElement('afterbegin',brand);
  }

  const oldTabs=nav.querySelector('.admin-section-tabs');
  if(oldTabs)oldTabs.hidden=true;

  let brandNav=nav.querySelector('.nisti-brand-nav');
  if(!brandNav){
    brandNav=document.createElement('div');
    brandNav.className='nisti-brand-nav';
    const items=[
      ['geral','home','Geral'],
      ['mockups','image','Mockups'],
      ['importacao','upload','Importação'],
      ['administracao','gear','Administração']
    ];
    brandNav.innerHTML=items.map(([view,ico,label])=>`<button type="button" data-brand-view="${view}">${icon(ico)}<span>${label}</span></button>`).join('');
    nav.prepend(brandNav);
  }

  brandNav.querySelectorAll('[data-brand-view]').forEach(button=>{
    button.classList.toggle('active',button.dataset.brandView===currentBrandView);
  });
}

function ensureFooterStrip(){
  const catalog=document.querySelector('.catalog-details');
  if(!catalog||document.querySelector('.nisti-brand-strip'))return;
  const strip=document.createElement('section');
  strip.className='nisti-brand-strip';
  strip.innerHTML=`
    <div><i>◉</i><p><strong>Identificação que conecta, valor que vende.</strong><span>Mantenha referências visuais consistentes para facilitar a operação.</span></p></div>
    <div><i>◎</i><p><strong>Padronização</strong><span>Mockups organizados e fáceis de localizar.</span></p></div>
    <div><i>▥</i><p><strong>Performance</strong><span>Consulta visual rápida para o time.</span></p></div>
    <div><i>☆</i><p><strong>Produtividade</strong><span>Menos tempo procurando o SKU correto.</span></p></div>
    <div><i>🎁</i><p><strong>Dica NISTI</strong><span>Use imagens frontais, nítidas e bem iluminadas.</span></p></div>`;
  catalog.insertAdjacentElement('afterend',strip);
}

function ensurePageHeader(){
  const panel=document.querySelector('.admin-dashboard-panel');
  if(!panel)return;
  let header=panel.querySelector(':scope > .admin-view-header');
  if(!header){
    header=document.createElement('section');
    header.className='admin-view-header';
    header.innerHTML='<div><span>NISTI PRINT</span><h2>Dashboard</h2><p></p></div>';
    panel.prepend(header);
  }
  const copy=BRAND_VIEWS[currentBrandView]||BRAND_VIEWS.geral;
  const h=header.querySelector('h2');
  const p=header.querySelector('p');
  if(h)h.textContent=copy[0];
  if(p)p.textContent=copy[1];
}

function findToolPanel(name){
  return document.querySelector(`.admin-tool-panel[data-tool-panel="${name}"]`);
}

function applyBrandView(){
  if(!isAdmin())return;
  document.documentElement.dataset.brandView=currentBrandView;
  ensureBrandHeader();
  ensurePageHeader();

  const kpis=document.querySelector('.admin-kpi-grid');
  const catalog=document.querySelector('.catalog-details');
  const system=document.querySelector('.admin-system-details');
  const tools=document.querySelector('.admin-tools-section');
  const health=document.querySelector('.admin-health-summary');
  const manual=findToolPanel('manual');
  const index=findToolPanel('indice');
  const imp=findToolPanel('importacao');
  const cad=findToolPanel('cadastro');

  [manual,index,imp,cad].forEach(el=>setVisible(el,false));
  setVisible(tools,false);
  setVisible(health,false);

  if(currentBrandView==='geral'){
    setVisible(kpis,true);
    setVisible(catalog,true);
    setVisible(system,false);
    if(catalog){
      catalog.open=true;
      const summary=catalog.querySelector(':scope > summary');
      if(summary)summary.textContent='Biblioteca de mockups';
    }
  }else if(currentBrandView==='mockups'){
    setVisible(kpis,false);
    setVisible(catalog,true);
    setVisible(system,false);
    if(catalog){
      catalog.open=true;
      const summary=catalog.querySelector(':scope > summary');
      if(summary)summary.textContent='Biblioteca de mockups';
    }
  }else if(currentBrandView==='importacao'){
    setVisible(kpis,false);
    setVisible(catalog,false);
    setVisible(system,false);
    [imp,cad].forEach(el=>{
      setVisible(el,true);
      el?.classList.add('tool-panel-visible');
    });
  }else if(currentBrandView==='administracao'){
    setVisible(kpis,false);
    setVisible(catalog,false);
    setVisible(system,true);
  }

  const strip=document.querySelector('.nisti-brand-strip');
  setVisible(strip,currentBrandView==='geral'||currentBrandView==='mockups');

  document.querySelectorAll('.nisti-brand-nav [data-brand-view]').forEach(button=>{
    button.classList.toggle('active',button.dataset.brandView===currentBrandView);
  });
}

function upgradeCatalogButtons(){
  document.querySelectorAll('.catalog-product').forEach(card=>{
    const buttons=[...card.querySelectorAll('button')];
    const edit=buttons.find(btn=>/editar mockup/i.test(btn.textContent||''));
    if(edit&&!edit.dataset.brandIcon){
      edit.dataset.brandIcon='1';
      edit.innerHTML='<span style="font-size:14px">✎</span> Editar mockup';
    }
  });
}

function upgradeGeneralPanel(){
  if(isAdmin())return;
  const header=document.querySelector('main.shell > header');
  if(header&&!header.querySelector('.general-brand-logo')){
    const logo=document.createElement('img');
    logo.src='/nisti-logo.svg';
    logo.alt='NISTI PRINT';
    logo.className='general-brand-logo';
    logo.style.cssText='width:220px;max-width:55vw;height:auto;margin-bottom:14px';
    header.insertAdjacentElement('afterbegin',logo);
  }
}

function apply(){
  if(isAdmin()){
    ensureBrandHeader();
    ensurePageHeader();
    ensureFooterStrip();
    upgradeCatalogButtons();
    applyBrandView();
  }else{
    upgradeGeneralPanel();
  }
}

document.addEventListener('click',event=>{
  const button=event.target.closest('.nisti-brand-nav [data-brand-view]');
  if(!button)return;
  event.preventDefault();
  event.stopPropagation();
  currentBrandView=button.dataset.brandView||'geral';
  applyBrandView();
  window.scrollTo({top:0,behavior:'auto'});
},true);

const root=document.getElementById('root');
if(root){
  const observer=new MutationObserver(()=>{
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      apply();
    });
  });
  observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class']});
}

apply();
setTimeout(apply,250);
setTimeout(apply,900);
