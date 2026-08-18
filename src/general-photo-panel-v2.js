const GENERAL_LOGO='/nisti-logo-transparent.webp';
let lastAutoFile=null;
let autoTimer=null;

function isGeneral(){return document.documentElement.dataset.nistiAccess==='general';}

function fixGeneralLogo(){
  if(!isGeneral()) return;
  const logo=document.querySelector('.general-brand-real');
  if(!logo) return;
  if(logo.getAttribute('src')!==GENERAL_LOGO) logo.setAttribute('src',GENERAL_LOGO);
  logo.style.background='transparent';
  logo.style.mixBlendMode='normal';
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
      },320);
    });
  }
}

function run(){fixGeneralLogo();enhanceFlow();}

run();
new MutationObserver(run).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-nisti-access']});
