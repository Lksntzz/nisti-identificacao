import './identification-performance.js';

let deferredInstallPrompt=null;

function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
}

function isGeneral(){
  return document.documentElement.dataset.nistiAccess==='general';
}

function isIOS(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent)||(/Macintosh/i.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
}

function ensureInstallStyles(){
  if(document.getElementById('nisti-pwa-styles')) return;
  const style=document.createElement('style');
  style.id='nisti-pwa-styles';
  style.textContent=`
    .nisti-install-app{position:fixed;right:18px;bottom:18px;z-index:9999;border:0;border-radius:16px;padding:13px 17px;background:linear-gradient(135deg,#7FD0D1,#C7EAFE);color:#253042;font:800 14px/1.1 Inter,system-ui,sans-serif;box-shadow:0 14px 34px rgba(53,91,105,.20);display:flex;align-items:center;gap:9px;cursor:pointer}
    .nisti-install-app:hover{transform:translateY(-1px)}
    .nisti-install-app svg{width:19px;height:19px}
    .nisti-install-help{position:fixed;inset:0;z-index:10000;background:rgba(31,39,53,.38);display:grid;place-items:center;padding:18px}
    .nisti-install-help-card{width:min(420px,100%);background:#fff;border-radius:22px;padding:22px;box-shadow:0 22px 70px rgba(30,40,60,.22);color:#253042;font-family:Inter,system-ui,sans-serif}
    .nisti-install-help-card h3{margin:0 0 8px;font-size:21px}.nisti-install-help-card p{margin:0 0 14px;color:#677082;line-height:1.45}.nisti-install-help-card ol{margin:0 0 18px;padding-left:20px;line-height:1.6}.nisti-install-help-card button{width:100%;border:0;border-radius:12px;background:#FF95BA;color:#fff;padding:12px;font-weight:800;cursor:pointer}
    @media(max-width:640px){.nisti-install-app{right:12px;bottom:12px}}
  `;
  document.head.appendChild(style);
}

function showIOSHelp(){
  const existing=document.querySelector('.nisti-install-help');
  if(existing) existing.remove();
  const overlay=document.createElement('div');
  overlay.className='nisti-install-help';
  overlay.innerHTML=`<div class="nisti-install-help-card"><h3>Instalar NISTI Identificação</h3><p>No iPhone, a instalação é feita pelo Safari.</p><ol><li>Toque no botão <strong>Compartilhar</strong>.</li><li>Escolha <strong>Adicionar à Tela de Início</strong>.</li><li>Confirme em <strong>Adicionar</strong>.</li></ol><button type="button">Entendi</button></div>`;
  overlay.addEventListener('click',e=>{if(e.target===overlay||e.target.closest('button')) overlay.remove();});
  document.body.appendChild(overlay);
}

function mountInstallButton(){
  const current=document.getElementById('nisti-install-app');
  if(!isGeneral()||isStandalone()){
    current?.remove();
    return;
  }
  if(current) return;
  ensureInstallStyles();
  const button=document.createElement('button');
  button.id='nisti-install-app';
  button.className='nisti-install-app';
  button.type='button';
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg><span>Instalar app</span>';
  button.addEventListener('click',async()=>{
    if(deferredInstallPrompt){
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(()=>null);
      deferredInstallPrompt=null;
      mountInstallButton();
      return;
    }
    if(isIOS()){
      showIOSHelp();
      return;
    }
    alert('No Chrome, abra o menu do navegador e escolha “Instalar app” ou “Adicionar à tela inicial”.');
  });
  document.body.appendChild(button);
}

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  mountInstallButton();
});

window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  document.getElementById('nisti-install-app')?.remove();
});

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{}));
}

const root=document.getElementById('root');
if(root){
  const observer=new MutationObserver(()=>mountInstallButton());
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-nisti-access']});
  observer.observe(root,{childList:true,subtree:true});
}

mountInstallButton();
setTimeout(mountInstallButton,300);
setTimeout(mountInstallButton,1200);
