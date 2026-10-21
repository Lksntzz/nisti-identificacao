import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TREATMENT_CONTROL_EVENT, TREATMENT_PAUSE_KEY } from '../product-image-treatment-worker.jsx';

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

export default function MuralProductImageManager({ products, onChanged, request }) {
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

