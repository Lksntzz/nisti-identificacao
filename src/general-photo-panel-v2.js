import './general-photo-panel-fallback.css';

const GENERAL_LOGO='/nisti-logo-transparent.webp?v=original-20260818';
let lastAutoFile=null;
let autoTimer=null;

function isGeneral(){return document.documentElement.dataset.nistiAccess==='general';}

function fixGeneralLogo(){
  if(!isGeneral()) return;
  const header=document.querySelector('main.shell > header');
  if(!header) return;

  header.querySelectorAll('.general-brand-fallback').forEach(el=>el.remove());
  const logos=[...header.querySelectorAll('.general-brand-real')];
  const logo=logos.shift();
  logos.forEach(el=>el.remove());
  if(!logo) return;

  if(logo.getAttribute('src')!==GENERAL_LOGO) logo.setAttribute('src',GENERAL_LOGO);
  logo.alt='NISTI PRINT';
  logo.hidden=false;
  logo.style.background='transparent';
  logo.style.mixBlendMode='normal';

  if(!logo.dataset.brandCleanBound){
    logo.dataset.brandCleanBound='1';
    logo.addEventListener('load',()=>{
      logo.hidden=false;
      header.classList.remove('nisti-logo-missing');
    });
    logo.addEventListener('error',()=>{
      logo.hidden=true;
      header.classList.add('nisti-logo-missing');
    });
  }
}

function productIdFromImage(src){
  const match=String(src||'').match(/\/api\/(?:result-images|images)\/(\d+)/);
  return match?.[1]||null;
}

function normalizeProductImage(img){
  if(!(img instanceof HTMLImageElement)) return;
  const raw=String(img.getAttribute('src')||'');
  const id=productIdFromImage(raw);
  if(!id) return;

  if(raw.includes('/api/result-images/')){
    img.src=`/api/images/${id}?fresh=migrate-${Date.now()}`;
  }

  img.loading='eager';
  img.decoding='async';

  if(img.dataset.productImageFallbackBound) return;
  img.dataset.productImageFallbackBound='1';
  img.addEventListener('error',()=>{
    const currentId=productIdFromImage(img.getAttribute('src')||img.src);
    if(!currentId) return;
    const attempts=Number(img.dataset.imageRetry||0);
    if(attempts>=2){
      img.classList.add('result-image-error');
      return;
    }
    img.dataset.imageRetry=String(attempts+1);
    img.src=`/api/images/${currentId}?fresh=retry-${Date.now()}-${attempts+1}`;
  });
  img.addEventListener('load',()=>img.classList.remove('result-image-error'));
}

function fixResultImages(){
  if(!isGeneral()) return;
  document.querySelectorAll('.panel.expedition img').forEach(img=>{
    if(img.closest('.camera')) return;
    normalizeProductImage(img);
  });
}

function enhanceFlow(){
  if(!isGeneral()) return;
  const panel=document.querySelector('.panel.expedition');
  if(!panel) return;
  panel.classList.add('general-panel-v2');
  const input=panel.querySelector('.camera input[type="file"]');
  const button=panel.querySelector(':scope > button');
  if(!input||!button) return;

  if(!input.dataset.autoIdentifyBound){
    input.dataset.autoIdentifyBound='1';
    input.addEventListener('change',()=>{
      const file=input.files?.[0];
      if(!file||file===lastAutoFile) return;
      lastAutoFile=file;
      clearTimeout(autoTimer);
      autoTimer=setTimeout(()=>{
        const currentButton=panel.querySelector(':scope > button');
        if(!currentButton||currentButton.disabled) return;
        const text=(currentButton.textContent||'').toLowerCase();
        if(text.includes('identificar produto')) currentButton.click();
      },180);
    });
  }
}

function run(){
  fixGeneralLogo();
  enhanceFlow();
  fixResultImages();
}

run();
new MutationObserver(()=>queueMicrotask(run)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-nisti-access']});