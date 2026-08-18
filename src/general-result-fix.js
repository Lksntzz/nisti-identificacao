import './general-result-fix.css';

function isGeneral(){
  return document.documentElement.dataset.nistiAccess === 'general';
}

function productIdFromImage(src){
  const text=String(src||'');
  const match=text.match(/\/api\/(?:result-images|images)\/(\d+)/);
  return match ? match[1] : null;
}

function normalizeResultImage(img){
  if(!(img instanceof HTMLImageElement)) return;
  const id=productIdFromImage(img.getAttribute('src')||img.src);
  if(!id) return;

  const current=String(img.getAttribute('src')||'');
  if(current.includes('/api/result-images/')){
    img.src=`/api/images/${id}?fresh=legacy-${Date.now()}`;
  }

  img.decoding='async';
  img.loading='eager';

  if(img.dataset.nistiFallbackBound==='1') return;
  img.dataset.nistiFallbackBound='1';
  img.addEventListener('load',()=>{
    img.dataset.imageError='0';
  });
  img.addEventListener('error',()=>{
    const productId=productIdFromImage(img.getAttribute('src')||img.src);
    if(!productId){
      img.dataset.imageError='1';
      return;
    }
    const attempts=Number(img.dataset.nistiImageAttempts||0);
    if(attempts>=2){
      img.dataset.imageError='1';
      return;
    }
    img.dataset.nistiImageAttempts=String(attempts+1);
    img.src=`/api/images/${productId}?fresh=retry-${Date.now()}-${attempts+1}`;
  });
}

function ensureBrand(){
  if(!isGeneral()) return;
  const header=document.querySelector('main.shell > header');
  if(!header) return;

  header.querySelectorAll('.general-brand-real').forEach(img=>{
    img.hidden=true;
    img.setAttribute('aria-hidden','true');
  });

  if(header.querySelector('.general-brand-clean')) return;
  const brand=document.createElement('div');
  brand.className='general-brand-clean';
  brand.setAttribute('aria-label','NISTI PRINT papelaria criativa');
  brand.innerHTML=`
    <span class="general-brand-clean__mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <span class="general-brand-clean__copy"><strong>NISTI PRINT</strong><small>papelaria criativa</small></span>
  `;
  header.prepend(brand);
}

function normalizeAll(){
  if(!isGeneral()) return;
  ensureBrand();
  document.querySelectorAll('.result img, img.result-image, [data-sku-selection] img').forEach(normalizeResultImage);
}

const observer=new MutationObserver(()=>queueMicrotask(normalizeAll));
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','data-nisti-access']});

document.addEventListener('DOMContentLoaded',normalizeAll,{once:true});
window.addEventListener('load',normalizeAll,{once:true});
setTimeout(normalizeAll,0);
setTimeout(normalizeAll,500);
