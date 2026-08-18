import './nisti-brand-final.css';

const LOGO_DATA = 'data:image/webp;base64,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';

let currentView = 'geral';
let scheduled = false;

const VIEW_COPY = {
  geral: ['Dashboard', 'Visão geral do catálogo e biblioteca de mockups.'],
  mockups: ['Mockups', 'Pesquise, confira e substitua mockups.'],
  importacao: ['Importação', 'Atualize o catálogo por CSV ou cadastre um produto individualmente.'],
  administracao: ['Administração', 'Acompanhe banco de dados, armazenamento e uso do Gemini.']
};

function isAdmin(){ return document.documentElement.dataset.nistiAccess === 'admin'; }

function icon(name){
  const icons={
    home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/>',
    image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
    upload:'<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 15v4h16v-4"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
}

function setVisible(el, visible){
  if(!el) return;
  if(visible){
    el.hidden=false;
    el.style.removeProperty('display');
  }else{
    el.hidden=true;
    el.style.setProperty('display','none','important');
  }
}

function classifyPanels(){
  const panel=document.querySelector('.panel:not(.expedition)');
  if(!panel) return;
  panel.classList.add('admin-dashboard-panel');
  const quick=panel.querySelector(':scope > .quick-workflow');
  if(quick){ quick.classList.add('admin-tool-panel'); quick.dataset.toolPanel='manual'; }
  panel.querySelectorAll(':scope > .form, :scope > form.form').forEach(child=>{
    const text=(child.textContent||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if(text.includes('importacao em massa')){ child.classList.add('admin-tool-panel'); child.dataset.toolPanel='importacao'; }
    else if(text.includes('indice visual das capas')){ child.classList.add('admin-tool-panel'); child.dataset.toolPanel='indice'; }
    else if(text.includes('cadastro manual de produto')){ child.classList.add('admin-tool-panel'); child.dataset.toolPanel='cadastro'; }
  });
}

function cleanLegacyUi(){
  document.querySelectorAll('.general-brand-logo,.nisti-brand-mark,.admin-section-tabs,.admin-tools-section').forEach(el=>el.remove());
  const header=document.querySelector('main.shell > header');
  const nav=header?.querySelector('nav');
  if(!header||!nav) return;
  nav.querySelectorAll(':scope > button,.legacy-admin-switch').forEach(btn=>btn.style.setProperty('display','none','important'));

  let brand=header.querySelector('.nisti-brand-real');
  if(!brand){
    brand=document.createElement('a');
    brand.className='nisti-brand-real';
    brand.href='/admin';
    header.prepend(brand);
  }
  brand.innerHTML=`<img src="${LOGO_DATA}" alt="NISTI PRINT">`;

  let title=header.querySelector('.nisti-header-title');
  if(!title){
    title=document.createElement('div');
    title.className='nisti-header-title';
    title.innerHTML='<h1>Identificação Visual</h1>';
    brand.insertAdjacentElement('afterend',title);
  }
  header.querySelectorAll('.admin-title-block').forEach(el=>el.style.setProperty('display','none','important'));

  const existing=[...nav.querySelectorAll('.nisti-brand-nav')];
  existing.slice(1).forEach(el=>el.remove());
  let brandNav=existing[0];
  if(!brandNav){
    brandNav=document.createElement('div');
    brandNav.className='nisti-brand-nav';
    brandNav.innerHTML=[
      ['geral','home','Geral'],
      ['mockups','image','Mockups'],
      ['importacao','upload','Importação'],
      ['administracao','gear','Administração']
    ].map(([view,ico,label])=>`<button type="button" data-brand-view="${view}">${icon(ico)}<span>${label}</span></button>`).join('');
    nav.prepend(brandNav);
  }
  brandNav.querySelectorAll('[data-brand-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.brandView===currentView));
}

function ensurePageHeader(){
  const panel=document.querySelector('.admin-dashboard-panel');
  if(!panel) return;
  let header=panel.querySelector(':scope > .admin-view-header');
  if(!header){
    header=document.createElement('section');
    header.className='admin-view-header';
    header.innerHTML='<div><span>NISTI PRINT</span><h2></h2><p></p></div>';
    panel.prepend(header);
  }
  const copy=VIEW_COPY[currentView]||VIEW_COPY.geral;
  header.querySelector('h2').textContent=copy[0];
  header.querySelector('p').textContent=copy[1];
  setVisible(header,currentView==='importacao'||currentView==='administracao');
}

function ensureSystemDetails(){
  const panel=document.querySelector('.admin-dashboard-panel');
  if(!panel) return null;
  let wrap=panel.querySelector('.admin-system-details');
  if(wrap) return wrap;
  wrap=document.createElement('section');
  wrap.className='admin-system-details';
  wrap.innerHTML=`
    <article class="system-detail-card" data-system="database"><span class="system-detail-icon">DB</span><div><small>Banco de dados · Cloudflare D1</small><strong>Carregando...</strong><p>Uso real do banco estruturado.</p><div class="system-progress"><i></i></div></div><em>Verificando</em></article>
    <article class="system-detail-card" data-system="r2"><span class="system-detail-icon">R2</span><div><small>Mockups e imagens · Cloudflare R2</small><strong>Carregando...</strong><p>Arquivos armazenados no bucket.</p><div class="system-progress"><i></i></div></div><em>Verificando</em></article>
    <article class="system-detail-card" data-system="gemini"><span class="system-detail-icon">✦</span><div><small>Gemini · identificação visual</small><strong>Carregando...</strong><p>Consultas e tokens registrados pelo app.</p><div class="system-progress"><i></i></div></div><em>Verificando</em></article>`;
  panel.appendChild(wrap);
  return wrap;
}

function getTool(name){ return document.querySelector(`.admin-tool-panel[data-tool-panel="${name}"]`); }

function applyView(){
  if(!isAdmin()) return;
  classifyPanels();
  cleanLegacyUi();
  ensurePageHeader();
  const kpis=document.querySelector('.admin-kpi-grid');
  const catalog=document.querySelector('.catalog-details');
  const system=ensureSystemDetails();
  const health=document.querySelector('.admin-health-summary');
  const manual=getTool('manual');
  const index=getTool('indice');
  const imp=getTool('importacao');
  const cad=getTool('cadastro');
  [manual,index,imp,cad].forEach(el=>setVisible(el,false));
  setVisible(health,false);

  if(currentView==='geral'){
    setVisible(kpis,true); setVisible(catalog,true); setVisible(system,false);
  }else if(currentView==='mockups'){
    setVisible(kpis,false); setVisible(catalog,true); setVisible(system,false);
  }else if(currentView==='importacao'){
    setVisible(kpis,false); setVisible(catalog,false); setVisible(system,false); setVisible(imp,true); setVisible(cad,true);
  }else{
    setVisible(kpis,false); setVisible(catalog,false); setVisible(system,true);
  }
  if(catalog){
    catalog.open=true;
    const summary=catalog.querySelector(':scope > summary');
    if(summary) summary.textContent='Biblioteca de mockups';
  }
  document.querySelectorAll('.nisti-brand-nav [data-brand-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.brandView===currentView));
}

function formatBytes(value){
  const n=Number(value||0); if(!n) return '0 KB';
  if(n<1048576) return `${(n/1024).toFixed(1)} KB`;
  if(n<1073741824) return `${(n/1048576).toFixed(2)} MB`;
  return `${(n/1073741824).toFixed(2)} GB`;
}
function fmt(n){ return Number(n||0).toLocaleString('pt-BR'); }

function updateKpis(products,indexData,systemData){
  const grid=document.querySelector('.admin-kpi-grid'); if(!grid) return;
  const cards=[...grid.querySelectorAll('.admin-kpi')];
  const withImage=products.filter(p=>p.image_url).length;
  const pending=products.length-withImage;
  const progress=products.length?Math.round(withImage/products.length*100):0;
  const values=[
    ['Produtos cadastrados',fmt(products.length),'Total de SKUs no sistema'],
    ['Mockups com imagem',fmt(withImage),pending?`${fmt(pending)} sem imagem`:'100% com imagem'],
    ['Pendentes',fmt(pending),pending?'Precisam de imagem':'Nenhum pendente'],
    ['Progresso do catálogo',`${progress}%`,`${fmt(withImage)} de ${fmt(products.length)} concluídos`],
    ['Banco de dados',systemData?.database?.used_bytes?formatBytes(systemData.database.used_bytes):'Online',`${fmt(products.length)} produtos · ${fmt(indexData?.indexed||indexData?.indexed_count||0)} referências`],
    ['Uso Gemini',systemData?.gemini?.today?.total_tokens?fmt(systemData.gemini.today.total_tokens):'Ativo',`${fmt(systemData?.gemini?.today?.identify_requests||0)} consulta(s) hoje`]
  ];
  cards.slice(0,6).forEach((card,i)=>{
    const [label,val,sub]=values[i];
    const labelNode=card.querySelector('small');
    const valNode=card.querySelector('.kpi-value,strong');
    const subNode=card.querySelector('.kpi-sub,span:last-child');
    if(labelNode) labelNode.textContent=label;
    if(valNode) valNode.textContent=val;
    if(subNode) subNode.textContent=sub;
  });
}

function updateSystemCard(key,value,copy,status='Saudável',percent=0){
  const card=document.querySelector(`[data-system="${key}"]`); if(!card) return;
  card.querySelector('strong').textContent=value;
  card.querySelector('p').textContent=copy;
  card.querySelector('em').textContent=status;
  card.querySelector('.system-progress i').style.width=`${Math.max(0,Math.min(100,percent))}%`;
}

async function refreshMetrics(){
  if(!isAdmin()) return;
  try{
    const [pRes,iRes,sRes,rRes]=await Promise.all([
      fetch('/api/products',{cache:'no-store'}),
      fetch('/api/admin/cover-index',{cache:'no-store'}),
      fetch('/api/admin/system-metrics',{cache:'no-store'}),
      fetch('/api/admin/storage-metrics',{cache:'no-store'})
    ]);
    const products=pRes.ok?(await pRes.json()).products||[]:[];
    const indexData=iRes.ok?await iRes.json():{};
    const systemData=sRes.ok?await sRes.json():{};
    const storageData=rRes.ok?await rRes.json():{};
    updateKpis(products,indexData,systemData);
    const db=systemData.database||{};
    updateSystemCard('database',`${formatBytes(db.used_bytes)} no D1`,'Banco estruturado usado pelo catálogo e índice visual.','Saudável',Number(db.percent_of_free_limit||0));
    const r2=storageData.r2||{};
    updateSystemCard('r2',`${formatBytes(r2.used_bytes)} · ${fmt(r2.object_count)} arquivo(s)`,'Mockups e imagens de referência armazenados no R2.','Saudável',Number(r2.percent_of_free_included_storage||0));
    const g=systemData.gemini||{}; const today=g.today||{};
    updateSystemCard('gemini',`${fmt(today.total_tokens)} tokens hoje`,`${fmt(today.identify_requests)} identificação(ões) · ${g.model||'Gemini'}.`,g.configured===false?'Sem chave':'Ativo',0);
  }catch{}
}

function upgradeGeneral(){
  if(isAdmin()) return;
  const header=document.querySelector('main.shell > header');
  if(!header) return;
  header.querySelectorAll('.general-brand-logo').forEach(el=>el.remove());
  let logo=header.querySelector('.general-brand-real');
  if(!logo){ logo=document.createElement('img'); logo.className='general-brand-real'; header.prepend(logo); }
  logo.src=LOGO_DATA; logo.alt='NISTI PRINT';
}

document.addEventListener('click',event=>{
  const btn=event.target.closest('.nisti-brand-nav [data-brand-view]');
  if(!btn) return;
  event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  currentView=btn.dataset.brandView||'geral';
  applyView(); window.scrollTo({top:0,behavior:'auto'});
},true);

function apply(){
  if(isAdmin()){ applyView(); refreshMetrics(); }
  else upgradeGeneral();
}

const root=document.getElementById('root');
if(root){
  new MutationObserver(()=>{
    if(scheduled) return;
    scheduled=true;
    requestAnimationFrame(()=>{ scheduled=false; applyView(); });
  }).observe(root,{childList:true,subtree:true});
}

apply();
setTimeout(apply,250);
setTimeout(apply,900);
setInterval(()=>{ if(isAdmin()) refreshMetrics(); },30000);
