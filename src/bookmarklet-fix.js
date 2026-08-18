const isAdminMode = new URLSearchParams(window.location.search).get('nisti_admin') === '1';

function buildBookmarklet() {
  const endpoint = `${window.location.origin}/api/admin/ml-browser-capture`;
  const code = `(()=>{try{alert('NISTI: capturador iniciado.');const E=${JSON.stringify(endpoint)},R=[],S=new Set(),A=(u,t,w,h)=>{if(!u)return;try{u=new URL(u,location.href).href}catch{return}if(!/^https:\/\/[^/]*mlstatic\.com\//i.test(u)||!/D_NQ_/i.test(u)||S.has(u))return;S.add(u);R.push({url:u,text:String(t||'').replace(/\\s+/g,' ').trim().slice(0,160),width:Math.round(w||0),height:Math.round(h||0)})};for(const i of document.images){const r=i.getBoundingClientRect(),c=i.closest('button,a,label,li,[role="button"],[role="option"],[role="radio"]'),t=[i.alt,i.title,c&&c.innerText,c&&c.getAttribute('aria-label')].filter(Boolean).join(' ');if(r.width>=18&&r.height>=18){A(i.currentSrc||i.src,t,r.width,r.height);for(const p of String(i.srcset||'').split(','))A(p.trim().split(/\\s+/)[0],t,r.width,r.height)}}if(!R.length){alert('NISTI: nenhuma imagem do Mercado Livre encontrada nesta tela.');return}alert('NISTI: '+R.length+' imagem(ns) encontrada(s). Enviando para o painel...');const F=document.createElement('form');F.method='POST';F.action=E;F.target='_blank';const D={source_url:location.href,page_title:document.title,payload:JSON.stringify(R)};for(const n in D){const I=document.createElement('input');I.type='hidden';I.name=n;I.value=D[n];F.appendChild(I)}document.body.appendChild(F);F.submit();setTimeout(()=>F.remove(),1000)}catch(e){alert('NISTI erro: '+(e&&e.message?e.message:String(e)))}})()`;
  return `javascript:${code}`;
}

if (isAdminMode) {
  document.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !/copiar capturador ml/i.test(button.textContent || '')) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const bookmarklet = buildBookmarklet();
    try {
      await navigator.clipboard.writeText(bookmarklet);
      const message = Array.from(document.querySelectorAll('p.message, .quick-message')).find(el =>
        /capturador|mercado livre/i.test(el.textContent || '')
      );
      if (message) message.textContent = 'Novo capturador copiado. Edite o favorito NISTI Capturar ML e substitua toda a URL pelo novo conteúdo copiado.';
      else alert('NISTI: novo capturador copiado. Edite o favorito e substitua toda a URL.');
    } catch {
      window.prompt('Copie toda esta URL e substitua a URL do favorito NISTI Capturar ML:', bookmarklet);
    }
  }, true);
}
