import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../mural-admin.css';
import { MuralCard, Hero, CollectionLaunchHero, CollectionLaunchCard } from '../mural-nisti.jsx';
import { productTypeLabel } from '../product-display.js';
import MuralPublicationsDashboard from './MuralPublicationsDashboard.jsx';
import { useTreatedProductImage } from '../mural-transparent-image.js';
import { TREATMENT_CONTROL_EVENT, TREATMENT_PAUSE_KEY } from '../product-image-treatment-worker.jsx';

const EMPTY_POST = {
  kind: 'notice', title: '', subtitle: '', body: '', badge: 'NOVO', badge_tone: 'success',
  product_id: '', collection_id: '', notice_level: 'info', featured: false, priority: 0,
  published_at: '', expires_at: ''
};


function AdminMuralIcon({ name, size = 22 }) {
  const common = {
    width:size, height:size, viewBox:'0 0 24 24', fill:'none',
    stroke:'currentColor', strokeWidth:1.9, strokeLinecap:'round', strokeLinejoin:'round',
    className: `mural-admin-icon-svg mural-admin-icon-svg-${name}`,
    'aria-hidden':true
  };
  if (name === 'product') return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.4 7.7 7.6 4.2 7.6-4.2M12 12v9"/></svg>;
  if (name === 'collection') return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>;
  if (name === 'notice') return <svg {...common}><path d="M4 13V9l12-5v14L4 13Z"/><path d="M16 8h2.5A2.5 2.5 0 0 1 21 10.5v1A2.5 2.5 0 0 1 18.5 14H16M6 13l1.5 6h4L10 14"/></svg>;
  if (name === 'sparkles') return <svg {...common}><path d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35L12 3Z"/><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></svg>;
  if (name === 'refresh') return <svg {...common}><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></svg>;
  if (name === 'check') return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  if (name === 'trash') return <svg {...common}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>;
  if (name === 'image') return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></svg>;
  if (name === 'back') return <svg {...common}><path d="m15 18-6-6 6-6"/></svg>;
  if (name === 'document') return <svg {...common}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></svg>;
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
  if (name === 'sliders') return <svg {...common}><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M8 15v4"/></svg>;
  if (name === 'more') return <svg {...common}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
  if (name === 'calendar') return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>;
  if (name === 'user') return <svg {...common}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>;
  if (name === 'home') return <svg {...common}><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></svg>;
  if (name === 'chevron') return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
  if (name === 'eye') return <svg {...common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></svg>;
  if (name === 'upload') return <svg {...common}><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 14v5h14v-5"/></svg>;
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>;
  if (name === 'info') return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/></svg>;
  if (name === 'close') return <svg {...common}><path d="m7 7 10 10M17 7 7 17"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>;
}

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(data?.error || `Erro ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function requestBlob(path, options = {}) {
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options });
  const type=response.headers.get('content-type')||'';
  if(!response.ok){
    const data=type.includes('application/json')?await response.json().catch(()=>({})):{};
    throw new Error(data?.error||`Erro ${response.status}`);
  }
  const blob=await response.blob();
  if(blob.type!=='image/png'||blob.size<1)throw new Error('O Canva não retornou um PNG válido.');
  return blob;
}

async function copyTextToClipboard(value) {
  const text = String(value || '');
  if (!text) throw new Error('O prompt ainda não foi preparado.');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Não foi possível copiar o prompt automaticamente.');
}

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function TransparentMuralProductImage({ src, alt = '', className = '', draggable = false, ariaHidden = false }) {
  const displaySrc = useTreatedProductImage(src, Boolean(src));
  if (!displaySrc) return null;
  return (
    <img
      src={displaySrc}
      alt={alt}
      className={`${className} mural-product-transparent`.trim()}
      draggable={draggable}
      aria-hidden={ariaHidden ? 'true' : undefined}
    />
  );
}

function TreatedImageLightbox({ product, busy, onClose, onApprove, onRedo }) {
  const [imageError,setImageError]=useState(false);

  useEffect(()=>{
    const previousOverflow=document.body.style.overflow;
    const closeOnEscape=event=>{if(event.key==='Escape')onClose()};
    document.body.style.overflow='hidden';
    window.addEventListener('keydown',closeOnEscape);
    return()=>{
      document.body.style.overflow=previousOverflow;
      window.removeEventListener('keydown',closeOnEscape);
    };
  },[onClose]);

  return createPortal(
    <div className="mural-product-image-lightbox" role="dialog" aria-modal="true" aria-label={`Imagem tratada de ${product.sku}`} onClick={onClose}>
      <div className="mural-product-image-lightbox-dialog" onClick={event=>event.stopPropagation()}>
        <header><div><strong>{product.sku}</strong><small>{product.nome||product.type||'Produto NISTI'}</small></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
        <div className="mural-product-image-lightbox-canvas">
          {!imageError
            ?<img src={product.previewSrc} alt={`Imagem tratada de ${product.sku}`} onError={()=>setImageError(true)}/>
            :<div className="mural-product-image-lightbox-error" role="alert"><strong>Não foi possível abrir a imagem tratada.</strong><span>Feche esta janela, atualize a lista e tente novamente.</span><button type="button" onClick={()=>setImageError(false)}>Tentar carregar novamente</button></div>}
        </div>
        <footer>
          {product.mural_image_reviewable&&<button type="button" className="approve" disabled={busy} onClick={()=>onApprove(product)}>Aprovar e mover para Revisados</button>}
          <button type="button" disabled={busy} onClick={()=>onRedo(product)}>Refazer com corte preciso</button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

function MuralProductImageManager({ products, onChanged }) {
  const [query,setQuery]=useState('');
  const [imageTab,setImageTab]=useState('review');
  const [previewProduct,setPreviewProduct]=useState(null);
  const [justApprovedIds,setJustApprovedIds]=useState(()=>new Set());
  const [busyId,setBusyId]=useState(null);
  const [error,setError]=useState('');
  const [canvaStatus,setCanvaStatus]=useState({loading:true,configured:false,connected:false,background_removal:false,missing:[]});
  const [canvaBusy,setCanvaBusy]=useState(false);
  const [paused,setPaused]=useState(()=>{
    try{return localStorage.getItem(TREATMENT_PAUSE_KEY)!=='0'}catch{return true}
  });
  const [treatmentProgress,setTreatmentProgress]=useState({
    loading:true,phase:'loading',with_image:0,approved:0,review:0,pending:0,failed:0,mask_total:0,mask_ready:0,mask_pending:0,current:null,error:''
  });
  const onChangedRef=useRef(onChanged);
  useEffect(()=>{onChangedRef.current=onChanged},[onChanged]);

  const refreshCanvaStatus=async()=>{
    try{
      const payload=await request('/api/admin/canva/status');
      setCanvaStatus({loading:false,configured:false,connected:false,background_removal:false,missing:[],...payload});
    }catch(err){
      setCanvaStatus(current=>({...current,loading:false,connected:false,error:err.message}));
    }
  };

  useEffect(()=>{refreshCanvaStatus()},[]);

  const connectCanva=async()=>{
    setCanvaBusy(true);setError('');
    try{
      const payload=await request('/api/admin/canva/connect',{method:'POST'});
      if(!payload?.authorization_url)throw new Error('Canva não retornou a URL de autorização.');
      window.location.assign(payload.authorization_url);
    }catch(err){
      setError(err.message);
      setCanvaBusy(false);
    }
  };

  const disconnectCanva=async()=>{
    if(!window.confirm('Desconectar o Canva do Mural NISTI?'))return;
    setCanvaBusy(true);setError('');
    try{
      await request('/api/admin/canva/disconnect',{method:'POST'});
      await refreshCanvaStatus();
    }catch(err){setError(err.message)}finally{setCanvaBusy(false)}
  };

  const filtered=useMemo(()=>{
    const term=query.trim().toLowerCase();
    const visible=imageTab==='approved'
      ?products.filter(item=>item.mural_image_ready)
      :imageTab==='review'
        ?products.filter(item=>item.mural_image_reviewable&&!justApprovedIds.has(Number(item.id)))
        :products.filter(item=>!item.mural_image_ready&&!item.mural_image_reviewable&&!justApprovedIds.has(Number(item.id)));
    if(!term)return visible;
    return visible.filter(item=>`${item.sku||''} ${item.nome||''} ${item.variacao||''}`.toLowerCase().includes(term));
  },[products,query,imageTab,justApprovedIds]);

  useEffect(()=>{
    let active=true;
    let polling=false;
    let refreshTimer=null;

    const mergeProgress=(detail={})=>{
      if(!active)return;
      if(detail.phase==='complete'||detail.phase==='paused')setPaused(true);
      setTreatmentProgress(current=>{
        const summary=detail.summary&&typeof detail.summary==='object'?detail.summary:{};
        const resolvedPhase=detail.phase||current.phase;
        const finished=['processed','failed','complete','paused'].includes(resolvedPhase);
        return {
          ...current,
          ...summary,
          loading:false,
          phase:resolvedPhase,
          current:resolvedPhase==='processing'?(detail.product||null):finished?null:current.current,
          error:detail.error||'',
        };
      });
      if(['processed','failed'].includes(detail.phase)){
        if(refreshTimer)window.clearTimeout(refreshTimer);
        refreshTimer=window.setTimeout(()=>{
          if(!active)return;
          Promise.all([
            refreshProgress(),
            Promise.resolve(onChangedRef.current?.())
          ]).catch(()=>{});
        },1200);
      }
    };

    const refreshProgress=async()=>{
      if(polling)return;
      polling=true;
      try{
        const payload=await request('/api/admin/product-image-treatment/summary');
        if(!active)return;
        const summary=payload?.summary||{};
        setTreatmentProgress(current=>({
          ...current,
          ...summary,
          loading:false,
          phase:paused?'paused':Number(summary.pending||0)>0?(current.current?'processing':'queue'):'complete',
          current:Number(summary.pending||0)>0?current.current:null,
          error:''
        }));
      }catch(err){
        if(active)setTreatmentProgress(current=>({...current,loading:false,phase:'error',error:err.message}));
      }finally{polling=false}
    };

    const onProgress=event=>mergeProgress(event.detail);
    const onSummaryRequest=()=>refreshProgress();
    window.addEventListener('nisti:product-image-treatment-progress',onProgress);
    window.addEventListener('nisti:product-image-treatment-summary-request',onSummaryRequest);
    refreshProgress();
    return()=>{
      active=false;
      if(refreshTimer)window.clearTimeout(refreshTimer);
      window.removeEventListener('nisti:product-image-treatment-progress',onProgress);
      window.removeEventListener('nisti:product-image-treatment-summary-request',onSummaryRequest);
    };
  },[paused]);

  const treatmentTotal=Number(treatmentProgress.with_image||0);
  const treatmentApproved=Number(treatmentProgress.approved||0);
  const treatmentReview=Number(treatmentProgress.review||0);
  const treatmentPending=Number(treatmentProgress.pending||0);
  const treatmentFailed=Number(treatmentProgress.failed||0);
  const maskTotal=Number(treatmentProgress.mask_total||treatmentTotal||0);
  const maskReady=Number(treatmentProgress.mask_ready||0);
  const maskPending=Number(treatmentProgress.mask_pending||0);
  const treatmentPercent=treatmentTotal?Math.min(100,Math.round(treatmentApproved*100/treatmentTotal)):0;
  const treatmentStatus=treatmentProgress.loading
    ?'Verificando a fila…'
    :paused
      ?'Aguardando início manual'
    :treatmentProgress.phase==='waiting'
      ?'A fila está sendo processada em outra aba'
    :treatmentProgress.current?.sku
      ?`Tratando agora: ${treatmentProgress.current.sku}`
      :treatmentPending>0
        ?'Preparando a próxima imagem…'
        :treatmentFailed>0
          ?`Processamento encerrado com ${treatmentFailed} falha${treatmentFailed===1?'':'s'}`
          :treatmentReview>0
            ?`${treatmentReview} imagem${treatmentReview===1?'':'ns'} aguardando aprovação`
            :'Todas as imagens foram revisadas';

  const setTreatmentPaused=next=>{
    setPaused(next);
    try{localStorage.setItem(TREATMENT_PAUSE_KEY,next?'1':'0')}catch{}
    window.dispatchEvent(new CustomEvent(TREATMENT_CONTROL_EVENT,{detail:{paused:next}}));
  };

  const upload=async(product,file)=>{
    if(!file)return;
    setBusyId(product.id);setError('');
    try{
      const form=new FormData();form.append('image',file);
      await request(`/api/admin/mural/products/${product.id}/image`,{method:'POST',body:form});
      window.dispatchEvent(new CustomEvent('nisti:product-image-treatment-summary-request'));
      await onChanged();
    }catch(err){setError(err.message)}finally{setBusyId(null)}
  };
  const remove=async product=>{
    if(!window.confirm(`Remover a imagem tratada de ${product.sku}? A original será preservada.`))return;
    setBusyId(product.id);setError('');
    try{
      await request(`/api/admin/mural/products/${product.id}/image`,{method:'DELETE'});
      window.dispatchEvent(new CustomEvent('nisti:product-image-treatment-summary-request'));
      await onChanged()
    }
    catch(err){setError(err.message)}finally{setBusyId(null)}
  };
  const approve=async product=>{
    setBusyId(product.id);setError('');
    try{
      await request(`/api/admin/product-image-treatment/${product.id}/approve`,{method:'POST'});
      window.dispatchEvent(new CustomEvent('nisti:product-image-treatment-summary-request'));
      setJustApprovedIds(current=>new Set(current).add(Number(product.id)));
      setImageTab('review');
      await onChanged();
    }
    catch(err){setError(err.message)}finally{setBusyId(null)}
  };
  const redo=async product=>{
    if(product.mural_image_ready&&!window.confirm(`Refazer o tratamento de ${product.sku}? A imagem aprovada deixará de ser usada até você aprovar a nova versão.`))return;
    setBusyId(product.id);setError('');
    try{
      await request(`/api/admin/product-image-treatment/${product.id}/redo`,{method:'POST'});
      window.dispatchEvent(new CustomEvent('nisti:product-image-treatment-summary-request'));
      await onChanged();
      if(!paused)window.dispatchEvent(new CustomEvent(TREATMENT_CONTROL_EVENT,{detail:{paused:false}}));
    }catch(err){setError(err.message)}finally{setBusyId(null)}
  };

  const canvaLabel=canvaStatus.loading
    ?'Verificando Canva…'
    :!canvaStatus.configured
      ?'Configuração pendente'
      :canvaStatus.connected&&canvaStatus.background_removal
        ?'Canva conectado'
        :canvaStatus.connected
          ?'Conectado sem remoção de fundo'
          :'Pronto para conectar';
  const canvaDetail=!canvaStatus.configured
    ?`Faltam segredos no Worker: ${(canvaStatus.missing||[]).join(', ')}`
    :canvaStatus.connected&&canvaStatus.background_removal
      ?'Remoção de fundo disponível. O fluxo de produção permanece bloqueado até a validação do PNG em tamanho original.'
      :canvaStatus.connected
        ?'A conta conectada não possui o recurso background_removal.'
        :'Autorize a conta Canva que será usada pelo Mural.';

  return <div className="mural-product-image-manager">
    <header><div><h3>Imagens tratadas dos produtos</h3><p>A foto original do catálogo fica intacta. Só vai para Revisados depois da sua aprovação.</p></div><div className="mural-product-image-manager-tools"><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar SKU ou nome"/></div></header>
    <section className={`mural-canva-bridge ${canvaStatus.connected?'connected':canvaStatus.configured?'ready':'missing'}`} aria-live="polite">
      <div>
        <span>Canva · integração segura</span>
        <strong>{canvaLabel}</strong>
        <small>{canvaDetail}</small>
      </div>
      <div className="mural-canva-bridge-actions">
        <button
          type="button"
          className={canvaStatus.connected?'connected':''}
          disabled={canvaStatus.connected||canvaBusy||canvaStatus.loading||!canvaStatus.configured}
          onClick={connectCanva}
        >
          {canvaStatus.loading?'Verificando Canva…':canvaStatus.connected?'Canva conectado':canvaBusy?'Abrindo…':'Conectar Canva'}
        </button>
        {canvaStatus.connected&&<button type="button" className="secondary" disabled={canvaBusy} onClick={disconnectCanva}>Desconectar</button>}
        <button type="button" className="secondary" disabled={canvaBusy||canvaStatus.loading} onClick={refreshCanvaStatus}>Verificar</button>
      </div>
    </section>
    <section className={`mural-product-treatment-progress ${treatmentProgress.phase}`} aria-live="polite">
      <div className="mural-product-treatment-progress-copy">
        <span>Tratamento manual</span>
        <strong>{treatmentProgress.loading?'Carregando…':`${treatmentApproved} de ${treatmentTotal} imagens aprovadas`}</strong>
        <small>{treatmentStatus}</small>
        <small>{maskPending>0?`Máscaras individuais: ${maskReady} de ${maskTotal} prontas · ${maskPending} pendentes`:`Máscaras individuais: ${maskReady} de ${maskTotal} prontas`}</small>
      </div>
      <div className="mural-product-treatment-progress-numbers">
        <span><b>{treatmentApproved}</b> aprovadas</span>
        <span><b>{treatmentReview}</b> para revisar</span>
        <span><b>{treatmentPending}</b> na fila</span>
        <span><b>{maskReady}</b> máscaras salvas</span>
        {treatmentFailed>0&&<span className="failed"><b>{treatmentFailed}</b> falhas</span>}
        <span className="mural-product-treatment-controls">
          <button type="button" className="start" disabled={!paused} onClick={()=>setTreatmentPaused(false)}>Iniciar tratamento</button>
          <button type="button" className="pause" disabled={paused} onClick={()=>setTreatmentPaused(true)}>Pausar tratamento</button>
        </span>
      </div>
      <div
        className="mural-product-treatment-progress-track"
        role="progressbar"
        aria-label="Progresso do tratamento das imagens"
        aria-valuemin="0"
        aria-valuemax={treatmentTotal||1}
        aria-valuenow={treatmentApproved}
      ><i style={{width:`${treatmentPercent}%`}}/></div>
    </section>
    {error&&<div className="mural-admin-error">{error}</div>}
    <nav className="mural-product-image-tabs" aria-label="Estado da revisão">
      <button type="button" className={imageTab==='queue'?'active':''} aria-pressed={imageTab==='queue'} onClick={()=>setImageTab('queue')}>
        Fila <b>{treatmentPending+treatmentFailed}</b>
      </button>
      <button type="button" className={imageTab==='review'?'active':''} aria-pressed={imageTab==='review'} onClick={()=>setImageTab('review')}>
        Revisar tratados <b>{treatmentReview}</b>
      </button>
      <button type="button" className={imageTab==='approved'?'active':''} aria-pressed={imageTab==='approved'} onClick={()=>setImageTab('approved')}>
        Revisados <b>{treatmentApproved}</b>
      </button>
    </nav>
    <div className="mural-product-image-manager-grid">
      {filtered.map(product=>{const previewSrc=product.mural_image_ready?product.image_url:product.mural_image_reviewable?product.review_image_url:null;const state=product.mural_image_ready?'approved':product.mural_image_reviewable?'review':product.mural_image_status==='failed'?'failed':product.mural_image_processor==='system-precise-redo'?'redo':'pending';const label={approved:'Aprovada e salva',review:'Aguardando aprovação',failed:'Falhou',redo:'Refazendo com corte preciso',pending:'Pendente'}[state];return <article key={product.id}>
        <div className="mural-product-image-pair">
          <figure><span>Original</span>{product.original_image_url?<img src={product.original_image_url} alt=""/>:<i>Sem imagem</i>}</figure>
          <figure className="processed"><span>PNG tratado</span>{previewSrc?<button type="button" className="mural-product-image-preview" onClick={()=>setPreviewProduct({...product,previewSrc,state})} aria-label={`Ampliar imagem tratada de ${product.sku}`}><img src={previewSrc} alt=""/></button>:<i>{state==='redo'?'Refazendo…':'Pendente'}</i>}</figure>
        </div>
        <div><b>{product.sku}</b><small>{product.nome||product.type||'Produto NISTI'}</small></div>
        <footer>
          <span className={`mural-product-image-state ${state}`}>{label}</span>
          {product.mural_image_reviewable&&<button type="button" className="approve" disabled={busyId!==null} onClick={()=>approve(product)}>Aprovar</button>}
          {['approved','review','failed'].includes(state)&&<button type="button" disabled={busyId!==null} onClick={()=>redo(product)}>{state==='failed'?'Tentar novamente':'Refazer'}</button>}
          <label className="mural-product-image-upload">{busyId===product.id?'Enviando…':'Enviar PNG'}<input type="file" accept="image/png" disabled={busyId!==null} onChange={event=>upload(product,event.target.files?.[0])}/></label>
          {(product.mural_image_ready||product.mural_image_reviewable)&&<button type="button" disabled={busyId!==null} onClick={()=>remove(product)}>Remover</button>}
        </footer>
      </article>})}
      {!filtered.length&&<div className="mural-product-image-manager-empty">Nenhuma imagem nesta fila.</div>}
    </div>
    {previewProduct&&<TreatedImageLightbox
      product={previewProduct}
      busy={busyId!==null}
      onClose={()=>setPreviewProduct(null)}
      onApprove={async product=>{await approve(product);setPreviewProduct(null)}}
      onRedo={async product=>{await redo(product);setPreviewProduct(null)}}
    />}
  </div>;
}

function postForm(row) {
  const source = row ?? EMPTY_POST;
  return {
    ...EMPTY_POST, ...source,
    product_id: source.product_id || '',
    collection_id: source.collection_id || '',
    featured: Boolean(source.featured),
    published_at: toLocalInput(source.published_at),
    expires_at: toLocalInput(source.expires_at)
  };
}

async function compressImage(file) {
  if (!file || file.size <= 0) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 5 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, .86));
  if (!blob) throw new Error('Não foi possível preparar a imagem.');
  return new File([blob], file.name, { type });
}

function Status({ value }) {
  const labels = { draft: 'Rascunho', published: 'Publicado', archived: 'Arquivado' };
  return <span className={`mural-admin-status ${value}`}><i aria-hidden="true" />{labels[value] || value}</span>;
}

function PublishTypeSelector({ activeKind, onSelect, locked = false }) {
  const options = [
    ['product','product','Produto','Destaque um produto do catálogo'],
    ['notice','document','Informação','Aviso ou comunicado interno'],
    ['collection','collection','Coleção','Vitrine temática com banner']
  ];
  return (
    <section className="mural-publish-v2-step mural-publish-v2-type-step">
      <header className="mural-publish-v2-step-heading">
        <span className="mural-publish-v2-step-number">1</span>
        <div>
          <strong>Escolha o tipo de publicação</strong>
          <small>Selecione o formato ideal para o conteúdo no Mural.</small>
        </div>
      </header>
      <div className="mural-publish-v2-type-grid">
        {options.map(([value,icon,label,description])=>{
          const active = activeKind === value;
          const disabled = locked && !active;
          return (
            <button
              type="button"
              key={value}
              className={active ? 'active' : ''}
              disabled={disabled}
              aria-pressed={active}
              onClick={() => !disabled && onSelect(value)}
            >
              <span className={"mural-publish-v2-type-icon is-" + value}><AdminMuralIcon name={icon} size={20}/></span>
              <span className="mural-publish-v2-type-copy">
                <b>{label}</b>
                <small>{description}</small>
              </span>
              <span className="mural-publish-v2-type-action">{active ? <AdminMuralIcon name="check" size={13}/> : <AdminMuralIcon name="chevron" size={14}/>}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CanvaArtworkModal({ isOpen, onClose, kind, metadata, imageFiles = [], imageUrls = [], onUseImage, onStatusChange }) {
  const [status, setStatus] = useState({ loading: true, connected: false, art_creation_ready: false, art_missing_scopes: [] });
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [design, setDesign] = useState(null);
  const [manualCreateUrl, setManualCreateUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [createCooldownUntil, setCreateCooldownUntil] = useState(0);
  const createLockRef = useRef(false);

  const load = async () => {
    setError('');
    try {
      const nextStatus = await request('/api/admin/canva/status');
      const st = { loading: false, connected: false, art_creation_ready: false, art_missing_scopes: [], ...nextStatus };
      setStatus(st);
      onStatusChange?.(st);
      if (!nextStatus?.connected || !nextStatus?.art_creation_ready) {
        setTemplates([]);
        return;
      }
      const payload = await request('/api/admin/canva/templates');
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setTemplates(items);
      setTemplateId(current => current && items.some(item => item.id === current) ? current : (items[0]?.id || ''));
    } catch (err) {
      setStatus(current => ({ ...current, loading: false }));
      setError(err.message);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setDesign(null);
      setManualCreateUrl('');
      load();
    }
  }, [isOpen, kind]);

  useEffect(() => {
    const remaining = createCooldownUntil - Date.now();
    if (remaining <= 0) return undefined;
    const timer = window.setTimeout(() => setCreateCooldownUntil(0), remaining);
    return () => window.clearTimeout(timer);
  }, [createCooldownUntil]);

  if (!isOpen) return null;

  const connect = async () => {
    setBusy('connect');
    setError('');
    try {
      const payload = await request('/api/admin/canva/connect', { method: 'POST' });
      if (!payload?.authorization_url) throw new Error('Canva não retornou a URL de autorização.');
      window.location.assign(payload.authorization_url);
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  };

  const appendRemoteImages = async formData => {
    let slot = 1;
    for (const src of imageUrls.filter(Boolean).slice(0, 6)) {
      try {
        const response = await fetch(src, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!/^image\/(png|jpeg|webp)$/i.test(blob.type || '')) continue;
        const key = slot === 1 ? 'image' : `image_${slot}`;
        formData.append(key, new File([blob], `nisti-canva-${slot}.${blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg'}`, { type: blob.type }));
        slot += 1;
      } catch {}
    }
  };

  const createDesign = async () => {
    if (createLockRef.current) return;
    if (createCooldownUntil > Date.now()) {
      setError('O Canva está em espera temporária. Aguarde um minuto antes de criar outra arte.');
      return;
    }
    if (!templateId) { setError('Escolha um template do Canva.'); return; }
    createLockRef.current = true;
    setBusy('create'); setError('');
    setManualCreateUrl('');
    setDesign(null);
    try {
      const formData = new FormData();
      formData.append('template_id', templateId);
      formData.append('metadata', JSON.stringify(metadata || {}));
      let slot = 1;
      for (const file of imageFiles.filter(Boolean).slice(0, 6)) {
        const key = slot === 1 ? 'image' : `image_${slot}`;
        formData.append(key, file);
        slot += 1;
      }
      if (slot <= 6) {
        const remoteData = new FormData();
        await appendRemoteImages(remoteData);
        for (const [key, value] of remoteData.entries()) {
          if (slot > 6) break;
          const target = slot === 1 ? 'image' : `image_${slot}`;
          formData.append(target, value);
          slot += 1;
        }
      }
      const payload = await request('/api/admin/canva/art/create', { method: 'POST', body: formData });
      if (payload?.mode === 'manual') {
        if (!payload.manual_create_url) throw new Error('O Canva não retornou um link para edição manual.');
        setManualCreateUrl(payload.manual_create_url);
      } else {
        if (!payload?.design?.id) throw new Error('O Canva não retornou a arte criada.');
        setDesign(payload.design);
      }
    } catch (err) {
      if (err?.status === 429) {
        setCreateCooldownUntil(Date.now() + 60_000);
        setError('O Canva atingiu o limite temporário. Aguarde um minuto e tente novamente apenas uma vez.');
      } else setError(err.message);
    } finally {
      createLockRef.current = false;
      setBusy('');
    }
  };

  const importDesign = async () => {
    if (!design?.id) return;
    setBusy('export'); setError('');
    try {
      const blob = await requestBlob('/api/admin/canva/art/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ design_id: design.id })
      });
      const file = new File([blob], `nisti-canva-${kind || 'arte'}-${design.id}.png`, { type: 'image/png' });
      await onUseImage?.(file);
      onClose?.();
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  const reconnectNeeded = status.connected && !status.art_creation_ready;

  return (
    <div className="mural-canva-modal-backdrop" onClick={onClose}>
      <div className="mural-canva-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Integração Canva">
        <header className="mural-canva-modal-header">
          <div className="mural-canva-modal-title">
            <span className="mural-canva-modal-icon"><AdminMuralIcon name="sparkles" size={18}/></span>
            <div>
              <strong>Arte da publicação · Canva</strong>
              <small>Crie e importe artes de templates oficiais da NISTI diretamente para o Mural.</small>
            </div>
          </div>
          <button type="button" className="mural-canva-modal-close" onClick={onClose} aria-label="Fechar modal Canva">
            <AdminMuralIcon name="close" size={16}/>
          </button>
        </header>

        <div className="mural-canva-modal-body">
          {status.loading ? (
            <div className="mural-publish-v2-canva-state">Verificando conexão com o Canva…</div>
          ) : !status.connected || reconnectNeeded ? (
            <div className="mural-publish-v2-canva-connect">
              <div className="mural-publish-v2-canva-connect-copy">
                <b>{reconnectNeeded ? 'Reconexão necessária' : 'Canva não conectado'}</b>
                <p>{reconnectNeeded ? 'A conexão atual precisa de novas autorizações para criar artes. Reconecte uma vez para continuar.' : 'Conecte sua conta do Canva para gerar e importar banners, produtos e comunicados com templates oficiais NISTI.'}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="mural-publish-v2-canva-controls">
                <label>
                  Template Oficial do Canva
                  <select value={templateId} onChange={e => { setTemplateId(e.target.value); setDesign(null); setManualCreateUrl(''); setError(''); }}>
                    {!templates.length && <option value="">Nenhum template oficial disponível</option>}
                    {templates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}
                  </select>
                </label>
              </div>
              {!templates.length && (
                <div className="mural-publish-v2-canva-hint">
                  Nenhum template oficial disponível na conta. Publique um Brand Template no Canva para utilizá-lo aqui.
                </div>
              )}
              {manualCreateUrl && (
                <div className="mural-canva-manual-state" role="status">
                  <strong>Edição manual disponível</strong>
                  <p>Este template não possui preenchimento automático. A arte será aberta no Canva para edição manual.</p>
                  <a className="mural-canva-edit-link" href={manualCreateUrl} target="_blank" rel="noopener noreferrer">
                    Abrir template no Canva ↗
                  </a>
                  <small>Depois de editar, exporte em PNG e envie o arquivo pelo campo de imagem da publicação no Mural.</small>
                </div>
              )}
              {design && (
                <div className="mural-publish-v2-canva-design">
                  <span className="mural-publish-v2-canva-design-thumb">
                    {design.thumbnail ? <img src={design.thumbnail} alt="Prévia do design Canva"/> : <AdminMuralIcon name="image" size={24}/>}
                  </span>
                  <div className="mural-publish-v2-canva-design-info">
                    <b>{design.title || 'Arte NISTI no Canva'}</b>
                    <small>Edite no Canva. Quando terminar, volte e importe a versão atualizada.</small>
                  </div>
                  <div className="mural-publish-v2-canva-design-actions">
                    {design.edit_url && (
                      <a href={design.edit_url} target="_blank" rel="noreferrer" className="mural-canva-edit-link">
                        Editar no Canva ↗
                      </a>
                    )}
                    <button type="button" className="mural-canva-use-btn" onClick={importDesign} disabled={Boolean(busy)}>
                      <AdminMuralIcon name="check" size={13}/>
                      {busy === 'export' ? 'Importando…' : 'Usar esta arte'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {error && <div className="mural-admin-error mural-publish-v2-canva-error">{error}</div>}
        </div>

        <footer className="mural-canva-modal-footer">
          <button type="button" className="mural-canva-modal-action mural-canva-modal-action-secondary" onClick={onClose}>Fechar</button>
          {status.connected && status.art_creation_ready && (
            <button
              type="button"
              className="mural-canva-modal-action mural-canva-modal-action-primary"
              disabled={!templateId || Boolean(busy) || createCooldownUntil > Date.now()}
              onClick={createDesign}
            >
              <AdminMuralIcon name="sparkles" size={15}/>
              {busy === 'create' ? 'Criando no Canva…' : createCooldownUntil > Date.now() ? 'Aguarde 1 min' : 'Criar no Canva'}
            </button>
          )}
          {(!status.connected || reconnectNeeded) && !status.loading && (
            <button type="button" className="mural-canva-modal-action mural-canva-modal-action-primary" onClick={connect} disabled={Boolean(busy)}>
              {busy === 'connect' ? 'Abrindo…' : reconnectNeeded ? 'Reconectar Canva' : 'Conectar com o Canva'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function PublishImageField({
  imageUrl,
  image,
  busy,
  onChoose,
  onRemove,
  onOpenCanva,
  canvaConnected,
  title = 'Imagem editorial (opcional)',
  helper = 'PNG, JPG ou WebP · até 5 MB',
  removeLabel = 'Remover imagem editorial'
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const fileInputRef = useRef(null);

  const handleDragOver = e => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = e => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = e => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onChoose?.(file);
  };

  const handleApplyUrl = () => {
    if (urlDraft.trim()) {
      onChoose?.(urlDraft.trim());
      setShowUrlInput(false);
      setUrlDraft('');
    }
  };

  return (
    <div className="mural-publish-v2-image-field">
      <div className="mural-publish-v2-field-label">
        <strong>{title}</strong>
        <AdminMuralIcon name="info" size={14}/>
      </div>

      {imageUrl ? (
        <div className="mural-publish-v2-image-card">
          <div className="mural-publish-v2-image-preview">
            <img src={imageUrl} alt="Imagem da publicação"/>
            <div className="mural-publish-v2-image-preview-overlay">
              <span className="mural-publish-v2-image-badge">
                <AdminMuralIcon name="check" size={12}/> Imagem pronta
              </span>
              <div className="mural-publish-v2-image-actions">
                <button
                  type="button"
                  className="mural-publish-v2-action-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  title="Trocar imagem"
                >
                  <AdminMuralIcon name="upload" size={13}/> Trocar
                </button>
                <button
                  type="button"
                  className="mural-publish-v2-action-btn is-danger"
                  onClick={onRemove}
                  disabled={busy}
                  aria-label={removeLabel}
                  title={removeLabel}
                >
                  <AdminMuralIcon name="close" size={13}/>
                </button>
              </div>
            </div>
          </div>
          {image && (
            <div className="mural-publish-v2-image-meta">
              <span title={image.name}>{image.name}</span>
              <small>{(image.size / (1024 * 1024)).toFixed(2)} MB</small>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files?.[0]) onChoose?.(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>
      ) : showUrlInput ? (
        <div className="mural-publish-v2-url-box">
          <label>
            <span>Colar link direto da imagem (URL)</span>
            <input
              type="url"
              placeholder="https://exemplo.com/imagem.png"
              value={urlDraft}
              onChange={e => setUrlDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleApplyUrl(); }}
              autoFocus
            />
          </label>
          <div className="mural-publish-v2-url-actions">
            <button type="button" className="is-cancel" onClick={() => setShowUrlInput(false)}>Cancelar</button>
            <button type="button" className="is-apply" onClick={handleApplyUrl} disabled={!urlDraft.trim()}>Usar URL</button>
          </div>
        </div>
      ) : (
        <div
          className={`mural-publish-v2-upload ${isDragging ? 'is-dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files?.[0]) onChoose?.(e.target.files[0]);
              e.target.value = '';
            }}
          />
          <span className="mural-publish-v2-upload-icon">
            <AdminMuralIcon name="image" size={24}/>
          </span>
          <span className="mural-publish-v2-upload-text">
            <b>Clique para enviar uma imagem</b>
            <small>ou arraste o arquivo até aqui · {helper}</small>
          </span>
          <div className="mural-publish-v2-upload-actions" onClick={e => e.stopPropagation()}>
            <span
              className="mural-publish-v2-upload-action"
              onClick={() => fileInputRef.current?.click()}
            >
              <AdminMuralIcon name="upload" size={14}/> Escolher arquivo
            </span>
            <button
              type="button"
              className="mural-publish-v2-url-toggle-btn"
              onClick={() => setShowUrlInput(true)}
              title="Colar link de imagem da internet"
            >
              Link URL
            </button>
            {onOpenCanva && (
              <button
                type="button"
                className="mural-publish-v2-canva-trigger-btn"
                onClick={onOpenCanva}
                title="Criar arte com Canva"
              >
                <AdminMuralIcon name="sparkles" size={13}/>
                Canva
              </button>
            )}
          </div>
        </div>
      )}
      {image && <small className="mural-publish-v2-image-ready">Imagem preparada e pronta para envio.</small>}
    </div>
  );
}

function PublishPreviewCard({ activeKind, form, product, collection, selectedProducts = [], imageUrl, onToggleFeatured }) {
  const [viewMode, setViewMode] = useState(form.featured ? 'hero' : 'feed'); // 'feed' | 'hero' | 'detail'
  const [tabFilter, setTabFilter] = useState(() => (
    activeKind === 'product' ? 'product' : activeKind === 'collection' ? 'collection' : activeKind === 'notice' ? 'notice' : 'all'
  ));

  useEffect(() => {
    if (activeKind) {
      setTabFilter(activeKind === 'product' ? 'product' : activeKind === 'collection' ? 'collection' : 'notice');
    }
  }, [activeKind]);

  const title = form.title || form.name || (
    activeKind === 'product' ? (product?.nome || product?.sku || 'Planner Especial') :
    activeKind === 'notice' ? 'Aviso Importante' :
    'Nova Coleção 2027'
  );

  const productPreview = (activeKind === 'product' && product) ? {
    id: Number(product.id),
    sku: product.sku || 'SKU-001',
    nome: product.nome || title,
    type: product.type || productTypeLabel(product) || 'Caderno Argolado',
    collection: product.collection_name || 'Coleção NISTI',
    wireo: product.wireo || 'Bronze',
    tassel: product.tassel || null,
    elastico: product.elastico || 'Rosa',
    image_url: product.image_url || null,
    mural_image_ready: Boolean(product.mural_image_ready)
  } : (activeKind === 'product') ? {
    id: 1,
    sku: 'SKU-EXEMPLO',
    nome: title,
    type: 'Produto NISTI',
    collection: 'Catálogo',
    wireo: 'Bronze',
    tassel: null,
    elastico: 'Preto',
    image_url: null,
    mural_image_ready: false
  } : null;

  const collectionProducts = selectedProducts.length > 0 ? selectedProducts : (collection?.preview_products || []);
  const collectionPreview = (activeKind === 'collection') ? {
    id: Number(collection?.id || 0),
    slug: form.slug || collection?.slug || 'nova-colecao',
    name: form.name || form.title || collection?.name || 'Nova Coleção',
    year: form.year ? Number(form.year) : (collection?.year ? Number(collection.year) : 2027),
    show_year: form.show_year !== false,
    hero_message: form.hero_message || form.subtitle || collection?.hero_message || 'Mais cor e elegância para o ano.',
    description: form.description || form.body || collection?.description || 'Coleção exclusiva com acabamentos premium.',
    preview_products: collectionProducts.slice(0, 4).map(p => ({
      id: Number(p.id),
      sku: p.sku || null,
      type: p.type || productTypeLabel(p),
      image_url: p.image_url || null,
      wireo: p.wireo || null,
      elastico: p.elastico || null,
      image_source: p.mural_image_ready ? 'product-processed' : 'product'
    }))
  } : null;

  const collectionImage = collection?.image_key
    ? `/api/admin/mural/collections/${collection.id}/image?v=${encodeURIComponent(collection.image_key)}`
    : '';

  const displayImage = imageUrl || (activeKind === 'product' ? product?.image_url : null) || collectionImage || null;

  const previewItem = {
    id: 0,
    kind: activeKind || 'notice',
    title,
    subtitle: form.subtitle || form.hero_message || (activeKind === 'notice' ? 'Linha de apoio' : ''),
    body: form.body || form.description || (activeKind === 'notice' ? 'Mensagem e orientações detalhadas para a expedição e produção.' : ''),
    badge: form.badge || (activeKind === 'notice' ? 'COMUNICADO INTERNO' : activeKind === 'collection' ? 'NOVA COLEÇÃO' : 'NOVO'),
    badge_tone: form.badge_tone || null,
    featured: Boolean(form.featured),
    published_at: form.published_at ? new Date(form.published_at).toISOString() : new Date().toISOString(),
    is_read: false,
    image_url: displayImage,
    image_source: imageUrl ? 'post' : (activeKind === 'product' ? 'product' : 'collection'),
    product: productPreview,
    collection: collectionPreview,
    notice_level: activeKind === 'notice' ? (form.notice_level || 'info') : null
  };

  const sampleProductItem = {
    id: 101,
    kind: 'product',
    title: 'Planner Espiral Floral 2027',
    subtitle: 'Acabamento holográfico com visão semanal',
    body: 'Miolo permanente, encadernação wire-o bronze e elástico rosa.',
    badge: 'NOVO',
    published_at: new Date(Date.now() - 3600000).toISOString(),
    is_read: true,
    product: {
      id: 101,
      sku: 'PLN-FLORAL-01',
      nome: 'Planner Espiral Floral 2027',
      type: 'Planner Semanal',
      wireo: 'Bronze',
      elastico: 'Rosa',
      collection: 'Jardim Secreto'
    }
  };

  const sampleNoticeItem = {
    id: 102,
    kind: 'notice',
    title: 'Conferência Obrigatória de Wire-o',
    subtitle: 'Procedimento padrão para turno da tarde',
    body: 'Verificar alinhamento do espiral e fechamento do elástico antes de embalar.',
    badge: 'COMUNICADO INTERNO',
    notice_level: 'attention',
    published_at: new Date(Date.now() - 7200000).toISOString(),
    is_read: true
  };

  const sampleCollectionItem = {
    id: 103,
    kind: 'collection',
    title: 'Coleção Minimalista 2027',
    subtitle: 'Linha executiva com tons pastéis',
    body: 'Lançamento exclusivo com acabamentos sóbrios e ferragens premium.',
    badge: 'NOVA COLEÇÃO',
    published_at: new Date(Date.now() - 14400000).toISOString(),
    is_read: false,
    collection: {
      id: 103,
      name: 'Coleção Minimalista',
      year: 2027,
      hero_message: 'Linha executiva com tons pastéis',
      preview_products: [
        { id: 1, sku: 'MIN-01', type: 'Planner' },
        { id: 2, sku: 'MIN-02', type: 'Caderno' }
      ]
    }
  };

  const [activeDetailItem, setActiveDetailItem] = useState(null);
  const [ctaFeedback, setCtaFeedback] = useState(false);
  const [simulatedPush, setSimulatedPush] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState(null);

  const openDetail = (itemToOpen) => {
    setActiveDetailItem(itemToOpen || previewItem);
    setViewMode('detail');
  };

  const currentDetailItem = activeDetailItem || previewItem;

  const handleAppTabClick = (tabKey) => {
    setTabFilter(tabKey);
    if (viewMode === 'detail') {
      setViewMode(form.featured ? 'hero' : 'feed');
    }
  };

  const triggerPushSimulation = () => {
    setSimulatedPush(true);
    setFeedbackToast('Notificação push simulada enviada para o dispositivo!');
    setTimeout(() => {
      setSimulatedPush(false);
      setFeedbackToast(null);
    }, 4500);
  };

  const handleTestCta = () => {
    setCtaFeedback(true);
    const msg = currentDetailItem.kind === 'notice'
      ? '✓ Leitura registrada no terminal do operador!'
      : currentDetailItem.kind === 'collection'
      ? '✓ Catálogo da coleção acessado com sucesso!'
      : '✓ Ficha técnica do produto aberta no sistema!';
    setFeedbackToast(msg);
    setTimeout(() => {
      setCtaFeedback(false);
      setFeedbackToast(null);
    }, 3000);
  };

  return (
    <aside className="mural-publish-v2-preview">
      <header>
        <div className="mural-publish-v2-preview-title-row">
          <div className="mural-publish-v2-preview-heading">
            <span className="mural-publish-v2-preview-icon"><AdminMuralIcon name="eye" size={20}/></span>
            <span>
              <strong>Prévia no Mural</strong>
              <small>Simulador interativo do app dos operadores</small>
            </span>
          </div>
          <div className="mural-preview-header-actions">
            {onToggleFeatured && (
              <button
                type="button"
                className={`mural-preview-featured-toggle-btn ${form.featured ? 'is-featured' : ''}`}
                onClick={onToggleFeatured}
                title="Fixar ou desfixar destaque no topo do feed"
              >
                <AdminMuralIcon name="star" size={13}/>
                <span>{form.featured ? 'Destaque ativo' : 'Fixar destaque'}</span>
              </button>
            )}
            <button
              type="button"
              className="mural-preview-test-push-btn"
              onClick={triggerPushSimulation}
              title="Testar como a notificação push chega para o operador"
            >
              <AdminMuralIcon name="bell" size={13}/>
              <span>Simular push</span>
            </button>
          </div>
        </div>

        {activeKind && (
          <div className="mural-publish-v2-preview-tabs" role="tablist" aria-label="Modo de visualização">
            <button
              type="button"
              className={viewMode === 'feed' ? 'active' : ''}
              onClick={() => { setViewMode('feed'); setActiveDetailItem(null); }}
              title="Ver no fluxo de cards do feed"
            >
              Feed de Cards
            </button>
            <button
              type="button"
              className={viewMode === 'hero' ? 'active' : ''}
              onClick={() => { setViewMode('hero'); setActiveDetailItem(null); }}
              title="Ver como banner de destaque no topo"
            >
              Banner Destaque {form.featured ? '★' : ''}
            </button>
            <button
              type="button"
              className={viewMode === 'detail' ? 'active' : ''}
              onClick={() => openDetail(previewItem)}
              title="Ver detalhes completos do card clicado"
            >
              Detalhe Expandido
            </button>
          </div>
        )}
      </header>

      <div className="mural-publish-v2-preview-body">
        <div className="mural-preview-smartphone" aria-label="Mockup do aplicativo móvel">
          {/* Dynamic Island */}
          <div className="mural-preview-dynamic-island" aria-hidden="true" />
          
          {/* Simulated Push Notification Banner */}
          {simulatedPush && (
            <div
              className="mural-preview-push-banner"
              onClick={() => { openDetail(previewItem); setSimulatedPush(false); }}
              role="button"
              tabIndex={0}
            >
              <div className="mural-preview-push-icon"><AdminMuralIcon name="notice" size={16}/></div>
              <div className="mural-preview-push-info">
                <div className="mural-preview-push-top">
                  <b>Mural NISTI</b>
                  <span>agora</span>
                </div>
                <strong>{previewItem.title}</strong>
                <p>{previewItem.subtitle || previewItem.body || 'Novo comunicado disponível no mural.'}</p>
              </div>
            </div>
          )}

          {/* Floating feedback toast */}
          {feedbackToast && (
            <div className="mural-preview-toast">
              <span>{feedbackToast}</span>
            </div>
          )}

          {/* Status Bar */}
          <div className="mural-preview-status-bar">
            <span>09:41</span>
            <div className="mural-preview-status-icons" aria-hidden="true">
              <span>5G</span>
              <span>●●●●</span>
              <div className="mural-preview-battery"><div className="mural-preview-battery-fill" /></div>
            </div>
          </div>

          {/* App Header */}
          <div className="mural-preview-app-header">
            <div className="mural-preview-app-title">
              <span className="mural-preview-sparkles" aria-hidden="true">✦✦✦</span>
              <b>Mural NISTI</b>
            </div>
            <div className="mural-preview-app-drops" aria-hidden="true">
              <span className="drop-cyan" />
              <span className="drop-pink" />
              <span className="drop-yellow" />
            </div>
          </div>

          {/* App Category Tabs */}
          <div className="mural-preview-app-tabs" role="tablist" aria-label="Filtro do app">
            <button
              type="button"
              className={tabFilter === 'all' ? 'active' : ''}
              onClick={() => handleAppTabClick('all')}
            >
              Tudo
            </button>
            <button
              type="button"
              className={tabFilter === 'product' ? 'active' : ''}
              onClick={() => handleAppTabClick('product')}
            >
              Produtos
            </button>
            <button
              type="button"
              className={tabFilter === 'collection' ? 'active' : ''}
              onClick={() => handleAppTabClick('collection')}
            >
              Coleções
            </button>
            <button
              type="button"
              className={tabFilter === 'notice' ? 'active' : ''}
              onClick={() => handleAppTabClick('notice')}
            >
              Avisos
            </button>
          </div>

          {/* Viewport */}
          <div className="mural-preview-viewport">
            {!activeKind ? (
              <div className="mural-preview-empty-card">
                <span><AdminMuralIcon name="notice" size={24} /></span>
                <b>Escolha o tipo de publicação</b>
                <small>Selecione Produto, Informação ou Coleção para acompanhar a prévia interativa em tempo real.</small>
              </div>
            ) : viewMode === 'detail' ? (
              <div className="mural-preview-detail-view">
                <button
                  type="button"
                  className="mural-preview-detail-back"
                  onClick={() => setViewMode(form.featured ? 'hero' : 'feed')}
                  aria-label="Voltar para a prévia do feed"
                >
                  ‹ Voltar ao feed
                </button>

                {currentDetailItem.image_url ? (
                  <div className="mural-preview-detail-media">
                    <img src={currentDetailItem.image_url} alt="Arte em destaque" />
                  </div>
                ) : currentDetailItem.kind === 'product' && (
                  <div className="mural-preview-detail-placeholder">
                    <AdminMuralIcon name="product" size={36}/>
                    <small>Foto padrão do catálogo</small>
                  </div>
                )}

                <div className="mural-card-badges">
                  {!currentDetailItem.is_read && <span className="mural-new-badge">NOVO</span>}
                  {currentDetailItem.kind === 'notice' && (
                    <span className={`mural-notice-label ${currentDetailItem.notice_level || 'info'}`}>
                      {currentDetailItem.notice_level === 'important' ? 'Importante' : currentDetailItem.notice_level === 'attention' ? 'Atenção' : 'Informação'}
                    </span>
                  )}
                  {currentDetailItem.badge && currentDetailItem.badge !== 'NOVO' && (
                    <span className="mural-editorial-badge">{currentDetailItem.badge}</span>
                  )}
                </div>

                <div className="mural-preview-detail-typography">
                  {currentDetailItem.kind === 'product' && currentDetailItem.product?.type && (
                    <span className="mural-preview-detail-kicker">{currentDetailItem.product.type}</span>
                  )}
                  <strong>{currentDetailItem.title}</strong>
                  {currentDetailItem.subtitle && <p className="mural-preview-detail-subtitle">{currentDetailItem.subtitle}</p>}
                  {currentDetailItem.body && <p className="mural-preview-detail-body">{currentDetailItem.body}</p>}
                </div>

                {currentDetailItem.kind === 'product' && currentDetailItem.product && (
                  <div className="mural-preview-detail-specs">
                    <div><b>SKU</b><span>{currentDetailItem.product.sku || 'N/A'}</span></div>
                    <div><b>Wire-o</b><span>{currentDetailItem.product.wireo || 'Padrão'}</span></div>
                    <div><b>Elástico</b><span>{currentDetailItem.product.elastico || 'Padrão'}</span></div>
                    <div><b>Coleção</b><span>{currentDetailItem.product.collection || 'Catálogo'}</span></div>
                  </div>
                )}

                {currentDetailItem.kind === 'collection' && (currentDetailItem.collection?.preview_products?.length > 0 || collectionProducts.length > 0) && (
                  <div className="mural-preview-collection-vitrine">
                    <header>
                      <b>Vitrine da coleção</b>
                      <small>{(currentDetailItem.collection?.preview_products || collectionProducts).length} produtos</small>
                    </header>
                    <div className="mural-preview-collection-chips">
                      {(currentDetailItem.collection?.preview_products || collectionProducts).slice(0, 6).map(p => (
                        <button
                          key={p.id}
                          type="button"
                          className="mural-preview-collection-chip-btn"
                          onClick={() => openDetail({
                            id: p.id,
                            kind: 'product',
                            title: p.nome || p.type || p.sku,
                            subtitle: `Produto da coleção ${currentDetailItem.title}`,
                            body: `SKU: ${p.sku || 'N/A'} • Wire-o: ${p.wireo || 'Padrão'} • Elástico: ${p.elastico || 'Padrão'}`,
                            badge: 'COLEÇÃO',
                            image_url: p.image_url || null,
                            product: p
                          })}
                          title={`Ver detalhes do ${p.sku || p.nome}`}
                        >
                          {p.image_url && <img src={p.image_url} alt=""/>}
                          <b>{p.sku || p.nome || p.type}</b>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {currentDetailItem.kind === 'notice' && (
                  <div className={`mural-preview-notice-callout is-${currentDetailItem.notice_level || 'info'}`}>
                    <AdminMuralIcon name="notice" size={18}/>
                    <span>Orientação prioritária para equipes de expedição e triagem.</span>
                  </div>
                )}

                <button
                  type="button"
                  className={`mural-preview-detail-action-btn ${ctaFeedback ? 'is-success' : ''}`}
                  onClick={handleTestCta}
                >
                  <AdminMuralIcon name={ctaFeedback ? 'check' : 'layers'} size={15}/>
                  <span>
                    {ctaFeedback
                      ? 'Ação executada com sucesso!'
                      : currentDetailItem.kind === 'collection'
                      ? 'Ver catálogo da coleção'
                      : currentDetailItem.kind === 'notice'
                      ? 'Confirmar leitura no terminal'
                      : 'Ver produto no catálogo'}
                  </span>
                </button>
              </div>
            ) : viewMode === 'hero' ? (
              <div className="mural-preview-hero-container">
                {activeKind === 'collection' ? (
                  <CollectionLaunchHero item={{ ...previewItem, featured: true }} onOpen={() => openDetail(previewItem)} />
                ) : (
                  <Hero item={{ ...previewItem, featured: true }} onOpen={() => openDetail(previewItem)} />
                )}
                <div className="mural-preview-click-hint">
                  <small>Clique no banner acima para abrir o detalhe em tela cheia.</small>
                </div>
              </div>
            ) : (
              <div className="mural-preview-feed-list">
                {/* Visualização de acordo com o filtro selecionado */}
                {tabFilter === 'all' && (
                  <>
                    {/* Destaque fixado (Hero) se featured for verdadeiro */}
                    {form.featured && (
                      activeKind === 'collection' ? (
                        <CollectionLaunchHero item={previewItem} onOpen={() => openDetail(previewItem)} />
                      ) : (
                        <Hero item={previewItem} onOpen={() => openDetail(previewItem)} />
                      )
                    )}

                    {/* Card normal de feed */}
                    {!form.featured && (
                      activeKind === 'collection' ? (
                        <CollectionLaunchCard item={previewItem} onOpen={() => openDetail(previewItem)} eager />
                      ) : (
                        <MuralCard item={previewItem} onOpen={() => openDetail(previewItem)} eager />
                      )
                    )}

                    {/* Outros itens contextuais interativos para compor o feed completo */}
                    <div className="mural-preview-secondary-card" title="Clique para abrir detalhe deste item">
                      <MuralCard
                        item={activeKind === 'product' ? sampleNoticeItem : sampleProductItem}
                        onOpen={() => openDetail(activeKind === 'product' ? sampleNoticeItem : sampleProductItem)}
                      />
                    </div>

                    <div className="mural-preview-secondary-card" title="Clique para abrir detalhe desta coleção">
                      <CollectionLaunchCard
                        item={sampleCollectionItem}
                        onOpen={() => openDetail(sampleCollectionItem)}
                      />
                    </div>
                  </>
                )}

                {tabFilter === 'product' && (
                  <>
                    {activeKind === 'product' ? (
                      form.featured ? (
                        <Hero item={previewItem} onOpen={() => openDetail(previewItem)} />
                      ) : (
                        <MuralCard item={previewItem} onOpen={() => openDetail(previewItem)} eager />
                      )
                    ) : (
                      <div className="mural-preview-tab-sample-wrap">
                        <div className="mural-preview-tab-sample-header">
                          <small>Exemplo do feed de Produtos:</small>
                        </div>
                        <MuralCard
                          item={sampleProductItem}
                          onOpen={() => openDetail(sampleProductItem)}
                        />
                      </div>
                    )}
                  </>
                )}

                {tabFilter === 'collection' && (
                  <>
                    {activeKind === 'collection' ? (
                      form.featured ? (
                        <CollectionLaunchHero item={previewItem} onOpen={() => openDetail(previewItem)} />
                      ) : (
                        <CollectionLaunchCard item={previewItem} onOpen={() => openDetail(previewItem)} eager />
                      )
                    ) : (
                      <div className="mural-preview-tab-sample-wrap">
                        <div className="mural-preview-tab-sample-header">
                          <small>Exemplo do feed de Coleções:</small>
                        </div>
                        <CollectionLaunchCard
                          item={sampleCollectionItem}
                          onOpen={() => openDetail(sampleCollectionItem)}
                        />
                      </div>
                    )}
                  </>
                )}

                {tabFilter === 'notice' && (
                  <>
                    {activeKind === 'notice' ? (
                      form.featured ? (
                        <Hero item={previewItem} onOpen={() => openDetail(previewItem)} />
                      ) : (
                        <MuralCard item={previewItem} onOpen={() => openDetail(previewItem)} eager />
                      )
                    ) : (
                      <div className="mural-preview-tab-sample-wrap">
                        <div className="mural-preview-tab-sample-header">
                          <small>Exemplo do feed de Avisos:</small>
                        </div>
                        <MuralCard
                          item={sampleNoticeItem}
                          onOpen={() => openDetail(sampleNoticeItem)}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer>
        <span className="mural-publish-v2-preview-pulse" aria-hidden="true" />
        <span>Prévia 100% interativa — teste abas, botões e clique nos cards para abrir o detalhe.</span>
      </footer>
    </aside>
  );
}

function MuralPublishWorkspace({ item, products = [], onClose, onSaved }) {
  const sourceItem = item && item.mode === 'new' ? null : item;
  const isEditingCollection = Boolean(sourceItem && (sourceItem.kind === 'collection' || sourceItem.product_ids !== undefined));
  const presetKind = sourceItem?.kind || (isEditingCollection ? 'collection' : (item?.mode === 'new' ? item?.kind || null : null));

  const [activeKind, setActiveKind] = useState(presetKind || 'product');
  const [form, setForm] = useState(() => postForm(sourceItem || (presetKind ? { ...EMPTY_POST, kind: presetKind } : null)));
  const [collectionForm, setCollectionForm] = useState(() => ({
    name: (isEditingCollection ? sourceItem?.name : '') || '',
    slug: (isEditingCollection ? sourceItem?.slug : '') || '',
    year: (isEditingCollection ? sourceItem?.year : '') || '',
    show_year: isEditingCollection ? (sourceItem?.show_year !== false && Number(sourceItem?.show_year ?? 1) !== 0) : true,
    hero_message: (isEditingCollection ? sourceItem?.hero_message : '') || '',
    visual_direction: (isEditingCollection ? sourceItem?.visual_direction : '') || 'automatic',
    theme_notes: (isEditingCollection ? sourceItem?.theme_notes : '') || '',
    description: (isEditingCollection ? sourceItem?.description : '') || '',
    status: (isEditingCollection ? sourceItem?.status : '') || 'active',
    featured: isEditingCollection ? Boolean(sourceItem?.featured ?? true) : true
  }));

  const [catalogProducts, setCatalogProducts] = useState(products);
  const [productQuery, setProductQuery] = useState(sourceItem?.product_sku || '');
  const [collectionProductQuery, setCollectionProductQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(sourceItem?.product_id ? {
    id: sourceItem.product_id,
    sku: sourceItem.product_sku,
    nome: sourceItem.product_name,
    miolo_code: sourceItem.product_miolo_code,
    type: sourceItem.product_type,
    image_url: sourceItem.product_image_url,
    wireo: sourceItem.product_wireo,
    tassel: sourceItem.product_tassel,
    elastico: sourceItem.product_elastico,
    collection_name: sourceItem.product_collection_name
  } : null);

  const [selectedCollectionProductIds, setSelectedCollectionProductIds] = useState(() => {
    if (isEditingCollection && sourceItem?.product_ids) {
      return String(sourceItem.product_ids).split(',').map(Number).filter(id => Number.isInteger(id) && id > 0);
    }
    return [];
  });

  const [image, setImage] = useState(() => sourceItem?.prefillImage || null);
  const [imageUrl, setImageUrl] = useState(() => {
    if (sourceItem?.prefillImage) return URL.createObjectURL(sourceItem.prefillImage);
    if (sourceItem?.image_key) {
      if (isEditingCollection) {
        return `/api/admin/mural/collections/${sourceItem.id}/image?v=${encodeURIComponent(sourceItem.image_key)}`;
      }
      return `/api/admin/mural/posts/${sourceItem.id}/image?v=${encodeURIComponent(sourceItem.image_key)}`;
    }
    return '';
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [canvaModalOpen, setCanvaModalOpen] = useState(false);
  const [canvaStatus, setCanvaStatus] = useState({ loading: true, connected: false });

  // Sync Canva status on mount
  useEffect(() => {
    request('/api/admin/canva/status')
      .then(s => setCanvaStatus({ loading: false, connected: Boolean(s?.connected && s?.art_creation_ready) }))
      .catch(() => setCanvaStatus({ loading: false, connected: false }));
  }, []);

  // Sync catalog products if passed or load
  useEffect(() => {
    if (products && products.length > 0) {
      setCatalogProducts(products);
    } else {
      request('/api/admin/mural/products?limit=500')
        .then(data => setCatalogProducts(data.items || []))
        .catch(() => {});
    }
  }, [products]);

  // Real-time product search for single product post
  useEffect(() => {
    if (activeKind !== 'product') return;
    if (!productQuery) return;
    const timer = setTimeout(() => {
      request(`/api/admin/mural/products?q=${encodeURIComponent(productQuery)}`)
        .then(data => setCatalogProducts(prev => {
          const incoming = data.items || [];
          const map = new Map(prev.map(p => [p.id, p]));
          incoming.forEach(p => map.set(p.id, p));
          return Array.from(map.values());
        }))
        .catch(() => {});
    }, 220);
    return () => clearTimeout(timer);
  }, [productQuery, activeKind]);

  useEffect(() => () => {
    if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const setCol = (key, value) => setCollectionForm(current => ({ ...current, [key]: value }));

  const changeKind = nextKind => {
    setActiveKind(nextKind);
    setError('');
    if (nextKind === 'notice') {
      setForm(current => ({
        ...current,
        kind: 'notice',
        product_id: '',
        collection_id: '',
        notice_level: current.notice_level || 'info',
        badge: ['COMUNICADO INTERNO','PROCESSO','NOVIDADE'].includes(current.badge) ? current.badge : 'COMUNICADO INTERNO'
      }));
    } else if (nextKind === 'product') {
      setForm(current => ({
        ...current,
        kind: 'product',
        collection_id: '',
        notice_level: null,
        badge: ['COMUNICADO INTERNO','PROCESSO','NOVIDADE'].includes(current.badge) ? 'NOVO' : (current.badge || 'NOVO')
      }));
    } else if (nextKind === 'collection') {
      setForm(current => ({
        ...current,
        kind: 'collection',
        badge: 'NOVA COLEÇÃO',
        featured: true
      }));
    }
  };

  const chooseProduct = prod => {
    setSelectedProduct(prod);
    setProductQuery(prod.sku || prod.nome || '');
    setForm(current => ({
      ...current,
      kind: 'product',
      product_id: prod.id,
      title: current.title || prod.nome || prod.variacao || prod.sku || ''
    }));
  };

  const toggleCollectionProduct = prodId => {
    setSelectedCollectionProductIds(cur => cur.includes(prodId) ? cur.filter(x => x !== prodId) : [...cur, prodId]);
  };

  const moveCollectionProduct = (prodId, direction) => {
    setSelectedCollectionProductIds(cur => {
      const idx = cur.indexOf(prodId);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= cur.length) return cur;
      const next = [...cur];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const chooseImage = async file => {
    setError('');
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return setError('Use JPEG, PNG ou WebP.');
    try {
      const prepared = await compressImage(file);
      if (prepared.size > 5 * 1024 * 1024) throw new Error('A imagem final excede 5 MB.');
      if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
      setImage(prepared);
      setImageUrl(URL.createObjectURL(prepared));
    } catch (err) { setError(err.message); }
  };

  const useCanvaImage = async file => {
    setError('');
    if (!file) return;
    if (file.type !== 'image/png') return setError('A arte exportada do Canva precisa estar em PNG.');
    if (file.size > 5 * 1024 * 1024) return setError('A arte exportada do Canva excede 5 MB.');
    if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    setImage(file);
    setImageUrl(URL.createObjectURL(file));
  };

  const removeImage = async () => {
    setError('');
    if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    setImage(null);
    if (!sourceItem?.id || !sourceItem?.image_key) { setImageUrl(''); return; }
    setBusy(true);
    try {
      if (isEditingCollection) {
        await request(`/api/admin/mural/collections/${sourceItem.id}/image`, { method: 'DELETE' });
      } else {
        await request(`/api/admin/mural/posts/${sourceItem.id}/image`, { method: 'DELETE' });
      }
      setImageUrl('');
      sourceItem.image_key = null;
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const save = async (publish = false) => {
    setError('');
    setBusy(true);
    try {
      if (activeKind === 'collection') {
        const name = collectionForm.name?.trim() || form.title?.trim();
        if (!name) { setError('Preencha o nome da coleção.'); setBusy(false); return; }
        if (publish && selectedCollectionProductIds.length === 0) {
          setError('Selecione ao menos 1 produto para publicar a coleção.'); setBusy(false); return;
        }

        const bodyData = {
          name,
          slug: collectionForm.slug?.trim() || '',
          year: collectionForm.year || '',
          show_year: collectionForm.show_year !== false,
          hero_message: collectionForm.hero_message?.trim() || form.subtitle?.trim() || '',
          visual_direction: collectionForm.visual_direction || 'automatic',
          theme_notes: collectionForm.theme_notes?.trim() || '',
          description: collectionForm.description?.trim() || form.body?.trim() || '',
          status: collectionForm.status || 'active'
        };

        const id = (sourceItem && isEditingCollection) ? sourceItem.id : null;
        let savedId = id;
        if (id) {
          await request(`/api/admin/mural/collections/${id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyData)
          });
        } else {
          const created = await request('/api/admin/mural/collections', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyData)
          });
          savedId = created.id;
        }

        if (selectedCollectionProductIds.length > 0) {
          await request(`/api/admin/mural/collections/${savedId}/products`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ product_ids: selectedCollectionProductIds })
          });
        }

        if (image) {
          const fd = new FormData();
          fd.append('image', image);
          await request(`/api/admin/mural/collections/${savedId}/image`, { method: 'POST', body: fd });
        }

        if (publish) {
          await request(`/api/admin/mural/collections/${savedId}/publish`, { method: 'POST' });
        }
      } else {
        // Product or Notice
        const title = form.title?.trim() || (activeKind === 'product' ? selectedProduct?.nome : '');
        if (!title) { setError('Preencha o título da publicação.'); setBusy(false); return; }
        if (activeKind === 'product' && !selectedProduct && !form.product_id) {
          setError('Selecione um produto no catálogo.'); setBusy(false); return;
        }

        const bodyData = {
          ...form,
          title,
          kind: activeKind,
          product_id: activeKind === 'product' ? Number(selectedProduct?.id || form.product_id) || null : null,
          collection_id: null,
          notice_level: activeKind === 'notice' ? (form.notice_level || 'info') : null,
          priority: Number(form.priority) || 0,
          published_at: form.published_at ? new Date(form.published_at).toISOString() : null,
          expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null
        };

        let id = (sourceItem && !isEditingCollection) ? sourceItem.id : null;
        if (id) {
          await request(`/api/admin/mural/posts/${id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyData)
          });
        } else {
          const created = await request('/api/admin/mural/posts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyData)
          });
          id = created.id;
        }

        if (image) {
          const fd = new FormData();
          fd.append('image', image);
          await request(`/api/admin/mural/posts/${id}/image`, { method: 'POST', body: fd });
        }

        if (publish) {
          await request(`/api/admin/mural/posts/${id}/publish`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ published_at: form.published_at ? new Date(form.published_at).toISOString() : null })
          });
        }
      }

      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Filtered products for collection picker
  const filteredCollectionCatalog = catalogProducts.filter(p =>
    !collectionProductQuery ||
    `${p.sku} ${p.nome || ''} ${p.variacao || ''}`.toLowerCase().includes(collectionProductQuery.toLowerCase())
  ).slice(0, 10);

  const selectedCollectionProducts = selectedCollectionProductIds
    .map(id => catalogProducts.find(p => Number(p.id) === Number(id)))
    .filter(Boolean);

  const publishLabel = form.published_at && new Date(form.published_at) > new Date() ? 'Agendar' : 'Publicar no Mural';
  const readyToSave = activeKind === 'collection'
    ? Boolean((collectionForm.name || form.title)?.trim())
    : Boolean(form.title?.trim() && (activeKind !== 'product' || selectedProduct || form.product_id));

  return (
    <section className="mural-publisher-workspace mural-studio-workspace" aria-label="Editor de publicação do Mural">
      {/* Top Studio Bar with all Primary Actions and Kind Selector */}
      <header className="mural-studio-topbar">
        <div className="mural-studio-topbar-left">
          <button type="button" className="mural-studio-back-btn" onClick={onClose} title="Voltar ao Painel">
            ‹ Voltar
          </button>
          <div className="mural-studio-heading">
            <h2>{sourceItem ? 'Editar no Mural' : 'Publicar no Mural'}</h2>
            <small>Expedição e produção NISTI</small>
          </div>
          <div className="mural-studio-kind-tabs" role="tablist" aria-label="Tipo de publicação">
            <button
              type="button"
              className={activeKind === 'product' ? 'active' : ''}
              disabled={Boolean(sourceItem)}
              onClick={() => changeKind('product')}
            >
              <AdminMuralIcon name="product" size={15}/>
              <span>Produto</span>
            </button>
            <button
              type="button"
              className={activeKind === 'notice' ? 'active' : ''}
              disabled={Boolean(sourceItem)}
              onClick={() => changeKind('notice')}
            >
              <AdminMuralIcon name="notice" size={15}/>
              <span>Informação</span>
            </button>
            <button
              type="button"
              className={activeKind === 'collection' ? 'active' : ''}
              disabled={Boolean(sourceItem)}
              onClick={() => changeKind('collection')}
            >
              <AdminMuralIcon name="collection" size={15}/>
              <span>Coleção</span>
            </button>
          </div>
        </div>

        <div className="mural-studio-topbar-right">
          <button
            type="button"
            className={`mural-studio-canva-btn ${canvaStatus.connected ? 'is-connected' : ''}`}
            onClick={() => setCanvaModalOpen(true)}
            title={canvaStatus.connected ? 'Abrir criação de arte no Canva' : 'Conectar conta Canva'}
          >
            <AdminMuralIcon name="sparkles" size={15}/>
            <span>{canvaStatus.connected ? 'Criar no Canva' : 'Conectar ao Canva'}</span>
            {canvaStatus.connected && <span className="mural-studio-online-dot" title="Canva pronto e conectado"/>}
          </button>
          <div className="mural-studio-topbar-divider" aria-hidden="true"/>
          <button type="button" className="mural-studio-btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="mural-studio-btn-subtle"
            disabled={busy || !readyToSave}
            onClick={() => save(false)}
          >
            <AdminMuralIcon name="document" size={14}/> Salvar rascunho
          </button>
          <button
            type="button"
            className="mural-studio-btn-primary"
            disabled={busy || !readyToSave}
            onClick={() => save(true)}
          >
            <AdminMuralIcon name="notice" size={15}/> {busy ? 'Processando…' : publishLabel}
          </button>
        </div>
      </header>

      {/* Main Studio Body: 2 Columns */}
      <div className="mural-studio-body">
        <form id="mural-publication-form" className="mural-studio-form" onSubmit={e => { e.preventDefault(); save(false); }}>
          
          {/* Card 1: Identificação & Imagem */}
          {activeKind === 'product' && (
            <section className="mural-studio-card">
              <header className="mural-studio-card-header">
                <strong>1. Produto e imagem de destaque</strong>
                <small>Vincule ao catálogo e defina a imagem principal.</small>
              </header>

              <div className="mural-studio-split-row">
                <div className="mural-studio-col">
                  <label className="mural-publish-v2-field mural-publish-v2-search">
                    Buscar produto no catálogo
                    <span>
                      <AdminMuralIcon name="search" size={16}/>
                      <input
                        value={productQuery}
                        onChange={e => setProductQuery(e.target.value)}
                        placeholder="Digite o SKU, nome ou código do produto..."
                      />
                    </span>
                  </label>

                  {selectedProduct && (
                    <div className="mural-studio-selected-product">
                      <figure>
                        {selectedProduct.image_url ? (
                          <TransparentMuralProductImage src={selectedProduct.image_url} alt={selectedProduct.nome || selectedProduct.sku}/>
                        ) : (
                          <AdminMuralIcon name="product" size={28}/>
                        )}
                      </figure>
                      <div className="mural-studio-selected-info">
                        <strong>{selectedProduct.nome || selectedProduct.variacao || 'Produto NISTI'}</strong>
                        <small>SKU: {selectedProduct.sku}{selectedProduct.collection_name ? ` · ${selectedProduct.collection_name}` : ''}</small>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSelectedProduct(null); set('product_id', ''); setProductQuery(''); }}
                        aria-label="Remover produto selecionado"
                        title="Remover produto selecionado"
                      >
                        <AdminMuralIcon name="close" size={14}/>
                      </button>
                    </div>
                  )}

                  {productQuery && !selectedProduct && (
                    <div className="mural-publish-v2-product-results">
                      {catalogProducts.slice(0, 6).map(prod => (
                        <button
                          type="button"
                          className={Number(form.product_id) === Number(prod.id) ? 'selected' : ''}
                          key={prod.id}
                          onClick={() => chooseProduct(prod)}
                        >
                          <figure>
                            {prod.image_url ? (
                              <TransparentMuralProductImage src={prod.image_url} alt="" ariaHidden/>
                            ) : (
                              <AdminMuralIcon name="product" size={19}/>
                            )}
                          </figure>
                          <span>
                            <b>{prod.nome || prod.variacao || prod.sku}</b>
                            <small>{prod.sku}</small>
                          </span>
                          {Number(form.product_id) === Number(prod.id) && <AdminMuralIcon name="check" size={14}/>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mural-studio-col">
                  <PublishImageField
                    imageUrl={imageUrl}
                    image={image}
                    busy={busy}
                    onChoose={chooseImage}
                    onRemove={removeImage}
                    onOpenCanva={() => setCanvaModalOpen(true)}
                    canvaConnected={canvaStatus.connected}
                    title="Imagem de apoio ou foto real (opcional)"
                    helper="PNG, JPG ou WebP · até 5 MB"
                  />
                </div>
              </div>
            </section>
          )}

          {activeKind === 'notice' && (
            <section className="mural-studio-card">
              <header className="mural-studio-card-header">
                <strong>1. Classificação e imagem do comunicado</strong>
                <small>Defina a prioridade e infográfico para a equipe.</small>
              </header>

              <div className="mural-studio-split-row">
                <div className="mural-studio-col">
                  <div className="mural-publish-v2-field-label">
                    <strong>Prioridade do comunicado</strong>
                    <AdminMuralIcon name="info" size={14}/>
                  </div>
                  <div className="mural-publish-v2-priority" role="group" aria-label="Prioridade da publicação">
                    {[
                      ['info','Normal','•'],
                      ['attention','Atenção','!'],
                      ['important','Importante','!']
                    ].map(([val,lbl,sym]) => (
                      <button
                        type="button"
                        key={val}
                        className={form.notice_level === val ? `active is-${val}` : `is-${val}`}
                        onClick={() => set('notice_level', val)}
                      >
                        <span>{sym}</span>{lbl}
                      </button>
                    ))}
                  </div>

                  <div className="mural-publish-v2-field-label" style={{ marginTop: '10px' }}>
                    <strong>Tipo de informação</strong>
                    <small>Define a categoria operacional.</small>
                  </div>
                  <div className="mural-publish-v2-category-chips">
                    {['COMUNICADO INTERNO','PROCESSO','NOVIDADE'].map(cat => (
                      <button
                        type="button"
                        key={cat}
                        className={form.badge === cat ? 'active' : ''}
                        onClick={() => set('badge', cat)}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mural-studio-col">
                  <PublishImageField
                    imageUrl={imageUrl}
                    image={image}
                    busy={busy}
                    onChoose={chooseImage}
                    onRemove={removeImage}
                    onOpenCanva={() => setCanvaModalOpen(true)}
                    canvaConnected={canvaStatus.connected}
                    title="Infográfico ou imagem de apoio (opcional)"
                    helper="PNG, JPG ou WebP · até 5 MB"
                  />
                </div>
              </div>
            </section>
          )}

          {activeKind === 'collection' && (
            <section className="mural-studio-card">
              <header className="mural-studio-card-header">
                <strong>1. Informações da coleção e banner</strong>
                <small>Ano, tema e arte visual da vitrine.</small>
              </header>

              <div className="mural-studio-split-row">
                <div className="mural-studio-col">
                  <div className="mural-publish-v2-field-row">
                    <label className="mural-publish-v2-field mural-publish-v2-year">
                      Ano da coleção
                      <input
                        type="number"
                        value={collectionForm.year}
                        onChange={e => setCol('year', e.target.value)}
                        placeholder="2027"
                      />
                    </label>
                    <label className="mural-publish-v2-field">
                      Slug <em className="muted">(opcional)</em>
                      <input
                        value={collectionForm.slug}
                        onChange={e => setCol('slug', e.target.value)}
                        placeholder="gerado automaticamente"
                      />
                    </label>
                  </div>

                  <label className="mural-publish-v2-field">
                    Direção visual
                    <select
                      value={collectionForm.visual_direction}
                      onChange={e => setCol('visual_direction', e.target.value)}
                    >
                      <option value="automatic">Automática (Harmonização inteligente)</option>
                      <option value="delicate">Delicada (Tons pastéis e florais)</option>
                      <option value="premium">Premium (Dourado, contrastes sóbrios)</option>
                      <option value="minimal">Minimalista (Geométrico, monocromático)</option>
                      <option value="playful">Divertida (Cores vivas e lúdicas)</option>
                    </select>
                  </label>

                  <details className="mural-publish-v2-collection-advanced">
                    <summary>Detalhes editoriais da coleção</summary>
                    <div>
                      <label className="mural-publish-v2-field">
                        Elementos / cores do tema
                        <textarea
                          rows="3"
                          maxLength="500"
                          value={collectionForm.theme_notes}
                          onChange={e => setCol('theme_notes', e.target.value)}
                          placeholder="Ex.: flores suaves, tons pastel e acabamento dourado."
                        />
                      </label>
                    </div>
                  </details>
                </div>

                <div className="mural-studio-col">
                  <PublishImageField
                    imageUrl={imageUrl}
                    image={image}
                    busy={busy}
                    onChoose={chooseImage}
                    onRemove={removeImage}
                    onOpenCanva={() => setCanvaModalOpen(true)}
                    canvaConnected={canvaStatus.connected}
                    title="Arte da coleção (banner 2:1 recomendado)"
                    helper="Recomendado: banner horizontal 2:1 · PNG, JPG ou WebP"
                    removeLabel="Remover banner da coleção"
                  />
                </div>
              </div>
            </section>
          )}

          {/* Card 2: Conteúdo Editorial */}
          <section className="mural-studio-card">
            <header className="mural-studio-card-header">
              <strong>2. Textos e conteúdo da publicação</strong>
              <small>Informações diretas exibidas nos cards para os operadores.</small>
            </header>

            <div className="mural-studio-copy-grid">
              <label className="mural-publish-v2-field">
                {activeKind === 'collection' ? 'Nome da coleção' : activeKind === 'notice' ? 'Título da informação' : 'Título da publicação'} <em>*</em>
                <input
                  maxLength="90"
                  required
                  value={activeKind === 'collection' ? collectionForm.name : form.title}
                  onChange={e => activeKind === 'collection' ? setCol('name', e.target.value) : set('title', e.target.value)}
                  placeholder={activeKind === 'collection' ? 'Ex.: Coleção Minimalista 2027' : activeKind === 'notice' ? 'Ex.: Nova conferência obrigatória de Wire-o' : 'Ex.: Planner Cactus 2027'}
                />
                <small>{String((activeKind === 'collection' ? collectionForm.name : form.title) || '').length}/90</small>
              </label>

              <label className="mural-publish-v2-field">
                {activeKind === 'collection' ? 'Frase de destaque (hero)' : 'Subtítulo / Linha de apoio'}
                <input
                  maxLength="120"
                  value={activeKind === 'collection' ? (collectionForm.hero_message || '') : (form.subtitle || '')}
                  onChange={e => activeKind === 'collection' ? setCol('hero_message', e.target.value) : set('subtitle', e.target.value)}
                  placeholder="Uma frase curta de impacto."
                />
                <small>{String((activeKind === 'collection' ? collectionForm.hero_message : form.subtitle) || '').length}/120</small>
              </label>

              <label className="mural-publish-v2-field mural-publish-v2-wide">
                {activeKind === 'collection' ? 'Descrição da coleção' : activeKind === 'notice' ? 'Mensagem completa do aviso' : 'Descrição curta'}
                <textarea
                  maxLength="700"
                  rows="3"
                  value={activeKind === 'collection' ? (collectionForm.description || '') : (form.body || '')}
                  onChange={e => activeKind === 'collection' ? setCol('description', e.target.value) : set('body', e.target.value)}
                  placeholder={activeKind === 'notice' ? 'Escreva a orientação completa para os operadores da expedição.' : 'Orientações e especificações que os operadores precisam saber.'}
                />
                <small>{String((activeKind === 'collection' ? collectionForm.description : form.body) || '').length}/700</small>
              </label>

              <label className="mural-publish-v2-field">
                Selo do card
                <input
                  maxLength="24"
                  value={form.badge || (activeKind === 'collection' ? 'NOVA COLEÇÃO' : '')}
                  onChange={e => set('badge', e.target.value)}
                  placeholder={activeKind === 'notice' ? 'COMUNICADO INTERNO' : activeKind === 'collection' ? 'NOVA COLEÇÃO' : 'NOVO'}
                />
                <small>{String(form.badge || '').length}/24</small>
              </label>

              <label className="mural-publish-v2-field">
                Ação no Mural
                <input value={activeKind === 'collection' ? 'Ver coleção' : activeKind === 'notice' ? 'Ver aviso' : 'Ver produto'} disabled/>
                <span className="mural-publish-v2-field-note">Padrão do sistema para este tipo de publicação.</span>
              </label>
            </div>
          </section>

          {/* Produtos da Coleção (quando for coleção) */}
          {activeKind === 'collection' && (
            <section className="mural-studio-card">
              <header className="mural-studio-card-header">
                <strong>Produtos da coleção <em>*</em></strong>
                <small>{selectedCollectionProducts.length} produto{selectedCollectionProducts.length === 1 ? '' : 's'} selecionado{selectedCollectionProducts.length === 1 ? '' : 's'}</small>
              </header>

              <label className="mural-publish-v2-field mural-publish-v2-search">
                <span>
                  <AdminMuralIcon name="search" size={16}/>
                  <input
                    value={collectionProductQuery}
                    onChange={e => setCollectionProductQuery(e.target.value)}
                    placeholder="Buscar SKU ou nome do produto para adicionar..."
                  />
                </span>
              </label>

              <div className="mural-publish-v2-collection-product-grid">
                {filteredCollectionCatalog.map(p => (
                  <button
                    type="button"
                    className={selectedCollectionProductIds.includes(p.id) ? 'selected' : ''}
                    key={p.id}
                    onClick={() => toggleCollectionProduct(p.id)}
                  >
                    <figure>
                      {p.image_url ? (
                        <TransparentMuralProductImage src={p.image_url} alt="" ariaHidden/>
                      ) : (
                        <AdminMuralIcon name="product" size={19}/>
                      )}
                    </figure>
                    <span>
                      <b>{p.nome || p.variacao || p.sku}</b>
                      <small>{p.sku}</small>
                    </span>
                    <span className="mural-publish-v2-product-check">
                      {selectedCollectionProductIds.includes(p.id) ? <AdminMuralIcon name="check" size={13}/> : '+'}
                    </span>
                  </button>
                ))}
              </div>

              {selectedCollectionProducts.length > 1 && (
                <div className="mural-publish-v2-order-list">
                  <header>
                    <strong>Ordem editorial</strong>
                    <small>Use as setas para definir a sequência da vitrine.</small>
                  </header>
                  <div>
                    {selectedCollectionProducts.map((product, index) => (
                      <article key={product.id}>
                        <span className="mural-publish-v2-drag" aria-label={`Posição ${index + 1}`}>{index + 1}</span>
                        <figure>
                          {product.image_url ? <TransparentMuralProductImage src={product.image_url} alt="" ariaHidden/> : <AdminMuralIcon name="product" size={18}/>}
                        </figure>
                        <span><b>{product.nome || product.variacao || product.sku}</b><small>{product.sku}</small></span>
                        <span className="mural-publish-v2-order-actions">
                          <button type="button" onClick={() => moveCollectionProduct(product.id, -1)} disabled={index === 0} aria-label={`Mover ${product.sku} para cima`}>↑</button>
                          <button type="button" onClick={() => moveCollectionProduct(product.id, 1)} disabled={index === selectedCollectionProducts.length - 1} aria-label={`Mover ${product.sku} para baixo`}>↓</button>
                        </span>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Card 3: Configurações & Agendamento */}
          <section className="mural-studio-card">
            <header className="mural-studio-card-header">
              <strong>3. Configurações de exibição</strong>
              <small>Defina quando e como o conteúdo será exibido no feed.</small>
            </header>

            <div className="mural-studio-settings-row">
              <label className="mural-publish-v2-setting-tile mural-publish-v2-switch">
                <input
                  type="checkbox"
                  checked={activeKind === 'collection' ? collectionForm.featured : form.featured}
                  onChange={e => activeKind === 'collection' ? setCol('featured', e.target.checked) : set('featured', e.target.checked)}
                />
                <span aria-hidden="true"/>
                <div>
                  <b>Fixar no topo do Mural</b>
                  <small>Exibe em destaque prioritário no feed.</small>
                </div>
              </label>

              {activeKind === 'collection' ? (
                <label className="mural-publish-v2-setting-tile mural-publish-v2-switch">
                  <input
                    type="checkbox"
                    checked={collectionForm.show_year}
                    onChange={e => setCol('show_year', e.target.checked)}
                  />
                  <span aria-hidden="true"/>
                  <div>
                    <b>Mostrar ano no banner</b>
                    <small>Exibe o ano junto ao título da coleção.</small>
                  </div>
                </label>
              ) : (
                <div className="mural-publish-v2-setting-tile mural-publish-v2-input-tile">
                  <div className="mural-publish-v2-tile-label">
                    <AdminMuralIcon name="calendar" size={15}/>
                    <span>Publicar em</span>
                  </div>
                  <input
                    type="datetime-local"
                    value={form.published_at}
                    onChange={e => set('published_at', e.target.value)}
                  />
                </div>
              )}

              {activeKind === 'collection' ? (
                <div className="mural-publish-v2-setting-tile mural-publish-v2-setting-note">
                  <span className="mural-publish-v2-note-icon"><AdminMuralIcon name="clock" size={18}/></span>
                  <div>
                    <b>Publicação imediata</b>
                    <small>Disponível logo após salvar.</small>
                  </div>
                </div>
              ) : (
                <div className="mural-publish-v2-setting-tile mural-publish-v2-input-tile">
                  <div className="mural-publish-v2-tile-label">
                    <AdminMuralIcon name="calendar" size={15}/>
                    <span>Expira em <em className="muted">(opcional)</em></span>
                  </div>
                  <input
                    type="datetime-local"
                    value={form.expires_at}
                    onChange={e => set('expires_at', e.target.value)}
                  />
                </div>
              )}

              {activeKind === 'collection' ? (
                <div className="mural-publish-v2-setting-tile mural-publish-v2-setting-note">
                  <span className="mural-publish-v2-note-icon"><AdminMuralIcon name="collection" size={18}/></span>
                  <div>
                    <b>{selectedCollectionProducts.length} produto{selectedCollectionProducts.length === 1 ? '' : 's'}</b>
                    <small>Na vitrine desta coleção.</small>
                  </div>
                </div>
              ) : (
                <div className="mural-publish-v2-setting-tile mural-publish-v2-input-tile">
                  <div className="mural-publish-v2-tile-label">
                    <AdminMuralIcon name="sliders" size={15}/>
                    <span>Ordem de exibição</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={form.priority}
                    onChange={e => set('priority', e.target.value)}
                    placeholder="0"
                  />
                </div>
              )}
            </div>
          </section>

          {error && <div className="mural-admin-error mural-publish-v2-error">{error}</div>}
        </form>

        {/* Prévia Interativa em Tempo Real */}
        <div className="mural-studio-preview-pane">
          <PublishPreviewCard
            activeKind={activeKind}
            form={activeKind === 'collection' ? { ...collectionForm, title: collectionForm.name, body: collectionForm.description, subtitle: collectionForm.hero_message, kind: 'collection', badge: form.badge || 'NOVA COLEÇÃO', featured: collectionForm.featured } : form}
            product={selectedProduct}
            collection={activeKind === 'collection' ? { ...collectionForm, id: sourceItem?.id || 0, preview_products: selectedCollectionProducts } : null}
            selectedProducts={selectedCollectionProducts}
            imageUrl={imageUrl}
            onToggleFeatured={() => {
              if (activeKind === 'collection') {
                setCol('featured', !collectionForm.featured);
              } else {
                set('featured', !form.featured);
              }
            }}
          />
        </div>
      </div>

      {/* Modal Oficial do Canva */}
      <CanvaArtworkModal
        isOpen={canvaModalOpen}
        onClose={() => setCanvaModalOpen(false)}
        kind={activeKind}
        metadata={{
          kind: activeKind,
          kind_label: activeKind === 'product' ? 'Produto' : activeKind === 'notice' ? 'Informação' : 'Coleção',
          title: activeKind === 'collection' ? collectionForm.name : form.title || selectedProduct?.nome || '',
          subtitle: activeKind === 'collection' ? collectionForm.hero_message : form.subtitle || '',
          body: activeKind === 'collection' ? collectionForm.description : form.body || '',
          badge: activeKind === 'collection' ? (form.badge || 'NOVA COLEÇÃO') : form.badge || '',
          sku: selectedProduct?.sku || '',
          cta: activeKind === 'collection' ? 'Ver coleção' : activeKind === 'product' ? 'Ver produto' : 'Ver aviso'
        }}
        imageFiles={image ? [image] : []}
        imageUrls={
          activeKind === 'product' && selectedProduct?.image_url
            ? [selectedProduct.image_url]
            : activeKind === 'collection'
            ? selectedCollectionProducts.slice(0, 6).map(p => p.image_url).filter(Boolean)
            : []
        }
        onUseImage={useCanvaImage}
        onStatusChange={st => setCanvaStatus({ loading: false, connected: Boolean(st?.connected && st?.art_creation_ready) })}
      />
    </section>
  );
}

function PostEditor(props) {
  return <MuralPublishWorkspace {...props} />;
}

function CollectionEditor(props) {
  return <MuralPublishWorkspace {...props} initialKind="collection" />;
}

export default function MuralNistiAdminView({ activeSection = 'dashboard', onSectionChange }) {
  const section = activeSection;
  const [posts,setPosts]=useState([]);
  const [collections,setCollections]=useState([]);
  const [products,setProducts]=useState([]);
  const [editor,setEditor]=useState(null);
  const [collectionEditor,setCollectionEditor]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [metrics,setMetrics]=useState(null);

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [p,c,prod,m]=await Promise.all([
        request('/api/admin/mural/posts'),
        request('/api/admin/mural/collections'),
        request('/api/admin/mural/products?limit=500'),
        request('/api/admin/mural/metrics')
      ]);
      setPosts(p.items||[]);setCollections(c.items||[]);setProducts(prod.items||[]);setMetrics(m||null);
    }catch(err){setError(err.message)}finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);

  const action=async(id,name)=>{
    try{setError('');await request(`/api/admin/mural/posts/${id}/${name}`,{method:'POST'});await load()}catch(err){setError(err.message)}
  };
  const sendPush=async row=>{
    if(!window.confirm(`Enviar notificação deste conteúdo para os dispositivos inscritos?\n\n${row.title}`))return;
    try{setError('');const result=await request(`/api/admin/mural/posts/${row.id}/push`,{method:'POST'});window.alert(`Notificação processada: ${result.sent||0} enviada(s), ${result.failed||0} falha(s).`)}catch(err){setError(err.message)}
  };

  const deletePost=async row=>{
    const confirmed=window.confirm(`Apagar esta publicação permanentemente?\n\n${row.title}\n\nEssa ação não pode ser desfeita.`);
    if(!confirmed)return;
    try{
      setError('');
      await request(`/api/admin/mural/posts/${row.id}`,{method:'DELETE'});
      await load();
    }catch(err){
      setError(err.message);
    }
  };

  const openPublicationEditor=row=>{
    if(row?.kind==='collection'){
      const linked=collections.find(collection=>Number(collection.id)===Number(row.collection_id));
      if(linked){
        setCollectionEditor(linked);
        return;
      }
      setError('A publicação aponta para uma coleção que não existe mais. A coleção vinculada não existe mais. Crie ou publique novamente pela ferramenta Publicar.');
      return;
    }
    setEditor(row);
  };

  const sectionMeta = {
    dashboard:{title:'Painel',description:'Visualize e gerencie as publicações já feitas no Mural.',icon:'document',eyebrow:'MURAL NISTI'},
    publish:{title:'Publicar',description:'Crie uma nova publicação de Produto, Informação ou Coleção.',icon:'sparkles',eyebrow:'MURAL NISTI'},
    treatment:{title:'Tratamento',description:'Trate, revise e aprove as imagens dos produtos usadas no Mural.',icon:'image',eyebrow:'PRODUÇÃO VISUAL'},
  };
  const currentSection = sectionMeta[section] || sectionMeta.dashboard;

  if (collectionEditor) {
    return <CollectionEditor
      item={collectionEditor.mode==='new'?null:collectionEditor}
      products={products}
      onClose={()=>setCollectionEditor(null)}
      onSaved={load}
      onSwitchKind={kind=>{setCollectionEditor(null);setEditor({mode:'new',kind})}}
    />;
  }

  if (editor) {
    return <PostEditor
      item={editor}
      onClose={()=>setEditor(null)}
      onSaved={load}
      onCreateCollection={()=>{setEditor(null);setCollectionEditor({mode:'new'})}}
    />;
  }

  if (section === 'publish') {
    return <PostEditor
      item={{mode:'new'}}
      onClose={()=>onSectionChange?.('dashboard')}
      onSaved={load}
      onCreateCollection={()=>setCollectionEditor({mode:'new'})}
    />;
  }

  return <section className="mural-admin-view mural-admin-dashboard">
    <header className="mural-admin-dashboard-header mural-admin-dashboard-header-hierarchy">
      <div className="mural-admin-dashboard-title">
        <span className="icon"><AdminMuralIcon name={currentSection.icon} size={22}/></span>
        <span><small className="mural-admin-section-eyebrow">{currentSection.eyebrow}</small><h2>{currentSection.title}</h2><p>{currentSection.description}</p></span>
      </div>
      <div className="mural-admin-dashboard-actions">
        <button type="button" className="qa" onClick={()=>window.location.assign('/?mural=qa')}>Área de teste</button>
      </div>
    </header>

    <div className="mural-admin-workspace mural-admin-workspace-single">
      <main className="mural-admin-workspace-content">
        {error&&<div className="mural-admin-error">{error}</div>}

        {section==='dashboard'&&<MuralPublicationsDashboard
          posts={posts}
          collections={collections}
          loading={loading}
          metrics={metrics}
          onEdit={openPublicationEditor}
          onAction={action}
          onPush={sendPush}
          onDelete={deletePost}
        />}

        {section==='treatment'&&<MuralProductImageManager products={products} onChanged={load}/>}

      </main>
    </div>

  </section>;
}
