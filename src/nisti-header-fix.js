if(!document.querySelector('link[data-nisti-logo-bg-fix]')){
  const link=document.createElement('link');
  link.rel='stylesheet';
  link.href='/src/nisti-logo-background-fix.css';
  link.dataset.nistiLogoBgFix='1';
  document.head.appendChild(link);
}

function isAdmin(){
  return document.documentElement.dataset.nistiAccess === 'admin';
}

function fixAdminHeader(){
  if(!isAdmin()) return;
  const header=document.querySelector('main.shell > header');
  if(!header) return;

  header.classList.add('nisti-app-header','admin-header');

  const logos=[...header.querySelectorAll('.nisti-brand-real')];
  logos.slice(1).forEach(el=>el.remove());
  const logo=logos[0];
  if(logo){
    logo.href='/admin';
    logo.style.setProperty('background','transparent','important');
    logo.querySelectorAll('img').forEach((img,index)=>{
      if(index>0){ img.remove(); return; }
      img.style.setProperty('background','transparent','important');
      img.style.setProperty('mix-blend-mode','multiply','important');
    });
  }

  let title=header.querySelector('.nisti-header-title');
  if(!title){
    title=document.createElement('div');
    title.className='nisti-header-title';
    title.innerHTML='<h1>Identificação Visual</h1>';
    if(logo) logo.insertAdjacentElement('afterend',title);
    else header.prepend(title);
  }
  const heading=title.querySelector('h1');
  if(heading) heading.textContent='Identificação Visual';

  header.querySelectorAll('.admin-title-block,.admin-section-tabs,.nisti-brand-mark').forEach(el=>{
    el.hidden=true;
    el.style.setProperty('display','none','important');
  });

  const nav=header.querySelector('nav');
  if(nav){
    nav.classList.add('admin-navigation');
    const brandNav=nav.querySelector('.nisti-brand-nav');
    const profile=header.querySelector('.admin-profile-chip');
    const logout=header.querySelector('.admin-logout');
    if(brandNav && brandNav.parentElement!==nav) nav.prepend(brandNav);
    if(profile && profile.parentElement!==nav) nav.appendChild(profile);
    if(logout && logout.parentElement!==nav) nav.appendChild(logout);
    if(brandNav){
      [...brandNav.children].forEach(child=>{
        if(!child.matches('[data-brand-view]')) child.remove();
      });
    }
  }

  document.querySelectorAll('.admin-tools-section').forEach(el=>el.remove());

  const catalog=document.querySelector('.catalog-details');
  if(catalog){
    catalog.open=true;
    const summary=catalog.querySelector(':scope > summary');
    if(summary && !/mockup/i.test(summary.textContent||'')) summary.textContent='Biblioteca de mockups';
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
setTimeout(fixAdminHeader,100);
setTimeout(fixAdminHeader,350);
setTimeout(fixAdminHeader,1000);
