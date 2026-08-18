function isAdmin(){
  return document.documentElement.dataset.nistiAccess === 'admin';
}

function fixAdminHeader(){
  if(!isAdmin()) return;
  const header=document.querySelector('main.shell > header');
  if(!header) return;

  const logos=[...header.querySelectorAll('.nisti-brand-real')];
  logos.slice(1).forEach(el=>el.remove());

  const title=header.querySelector('.admin-title-block h1');
  if(title && title.textContent!=='Identificação Visual') title.textContent='Identificação Visual';

  header.querySelectorAll('.admin-section-tabs').forEach(el=>{ el.hidden=true; });
  document.querySelectorAll('.admin-tools-section').forEach(el=>el.remove());

  const catalog=document.querySelector('.catalog-details');
  if(catalog){
    catalog.open=true;
    const summary=catalog.querySelector(':scope > summary');
    if(summary) summary.textContent='Biblioteca de mockups';
  }
}

const root=document.getElementById('root');
if(root){
  let scheduled=false;
  new MutationObserver(()=>{
    if(scheduled) return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      fixAdminHeader();
    });
  }).observe(root,{childList:true,subtree:true});
}

fixAdminHeader();
setTimeout(fixAdminHeader,250);
setTimeout(fixAdminHeader,900);
