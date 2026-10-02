import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../mural-admin.css';
import { MuralCard } from '../mural-nisti.jsx';
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
  if (name === 'chevron') return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>;
}

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`);
  return data;
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

function formatBytes(value) {
  if (value === null || value === undefined || value === '') return '—';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function ReadinessBadge({ ok, unknown = false }) {
  const state = unknown ? 'unknown' : ok ? 'ok' : 'pending';
  const label = unknown ? 'Não medido' : ok ? 'OK' : 'Pendente';
  return <span className={`mural-admin-readiness-badge ${state}`}>{label}</span>;
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

function MuralProductImageManager({ products, onChanged }) {
  const [query,setQuery]=useState('');
  const [showApproved,setShowApproved]=useState(false);
  const [justApprovedIds,setJustApprovedIds]=useState(()=>new Set());
  const [busyId,setBusyId]=useState(null);
  const [error,setError]=useState('');
  const [paused,setPaused]=useState(()=>{
    try{return localStorage.getItem(TREATMENT_PAUSE_KEY)==='1'}catch{return false}
  });
  const [treatmentProgress,setTreatmentProgress]=useState({
    loading:true,phase:'loading',with_image:0,approved:0,review:0,pending:0,failed:0,current:null,error:''
  });
  const onChangedRef=useRef(onChanged);
  useEffect(()=>{onChangedRef.current=onChanged},[onChanged]);
  const filtered=useMemo(()=>{
    const term=query.trim().toLowerCase();
    const visible=showApproved
      ?products.filter(item=>item.mural_image_ready)
      :products.filter(item=>!item.mural_image_ready&&!justApprovedIds.has(Number(item.id)));
    if(!term)return visible;
    return visible.filter(item=>`${item.sku||''} ${item.nome||''} ${item.variacao||''}`.toLowerCase().includes(term));
  },[products,query,showApproved,justApprovedIds]);

  useEffect(()=>{
    let active=true;
    let polling=false;
    let refreshTimer=null;

    const mergeProgress=(detail={})=>{
      if(!active)return;
      setTreatmentProgress(current=>{
        const summary=detail.summary&&typeof detail.summary==='object'?detail.summary:{};
        const phase=detail.phase||current.phase;
        const finished=['processed','failed'].includes(phase);
        return {
          ...current,
          ...summary,
          loading:false,
          phase,
          current:phase==='processing'?(detail.product||null):finished?null:current.current,
          error:detail.error||''
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
  const treatmentPercent=treatmentTotal?Math.min(100,Math.round(treatmentApproved*100/treatmentTotal)):0;
  const treatmentStatus=treatmentProgress.loading
    ?'Verificando a fila…'
    :paused
      ?'Tratamento pausado por você'
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

  const togglePaused=()=>{
    const next=!paused;
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
      setShowApproved(false);
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

  return <div className="mural-product-image-manager">
    <header><div><h3>Imagens tratadas dos produtos</h3><p>A foto original do catálogo fica intacta. Só desaparece da revisão depois da sua aprovação.</p></div><div className="mural-product-image-manager-tools"><button type="button" onClick={()=>setShowApproved(value=>!value)}>{showApproved?'Ocultar aprovadas':'Ver aprovadas'}</button><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar SKU ou nome"/></div></header>
    <section className={`mural-product-treatment-progress ${treatmentProgress.phase}`} aria-live="polite">
      <div className="mural-product-treatment-progress-copy">
        <span>Tratamento automático</span>
        <strong>{treatmentProgress.loading?'Carregando…':`${treatmentApproved} de ${treatmentTotal} imagens aprovadas`}</strong>
        <small>{treatmentStatus}</small>
      </div>
      <div className="mural-product-treatment-progress-numbers">
        <span><b>{treatmentApproved}</b> aprovadas</span>
        <span><b>{treatmentReview}</b> para revisar</span>
        <span><b>{treatmentPending}</b> na fila</span>
        {treatmentFailed>0&&<span className="failed"><b>{treatmentFailed}</b> falhas</span>}
        <button type="button" className="mural-product-treatment-toggle" onClick={togglePaused}>{paused?'Iniciar tratamento':'Pausar tratamento'}</button>
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
    <div className="mural-product-image-manager-grid">
      {filtered.map(product=>{const previewSrc=product.mural_image_ready?product.image_url:product.mural_image_reviewable?product.review_image_url:null;const state=product.mural_image_ready?'approved':product.mural_image_reviewable?'review':product.mural_image_status==='failed'?'failed':product.mural_image_processor==='system-precise-redo'?'redo':'pending';const label={approved:'Aprovada e salva',review:'Aguardando aprovação',failed:'Falhou',redo:'Refazendo com borda',pending:'Pendente'}[state];return <article key={product.id}>
        <div className="mural-product-image-pair">
          <figure><span>Original</span>{product.original_image_url?<img src={product.original_image_url} alt=""/>:<i>Sem imagem</i>}</figure>
          <figure className="processed"><span>PNG tratado</span>{previewSrc?<img src={previewSrc} alt=""/>:<i>{state==='redo'?'Refazendo…':'Pendente'}</i>}</figure>
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

function MobilePreview({ form, product, collection, imageUrl }) {
  const title = form.title || 'Título da publicação';
  const productPreview = form.kind === 'product' && product ? {
    id: Number(product.id),
    sku: product.sku || null,
    type: product.type || productTypeLabel(product),
    collection: product.collection_name || null,
    wireo: product.wireo || null,
    tassel: product.tassel || null,
    elastico: product.elastico || null
  } : null;
  const collectionPreview = form.kind === 'collection' && collection ? {
    id: Number(collection.id),
    slug: collection.slug || '',
    name: collection.name || '',
    year: collection.year ? Number(collection.year) : null
  } : null;
  const collectionImage = collection?.image_key
    ? `/api/admin/mural/collections/${collection.id}/image?v=${encodeURIComponent(collection.image_key)}`
    : '';
  const previewItem = {
    id: 0,
    kind: form.kind,
    title,
    subtitle: form.subtitle || null,
    body: form.body || null,
    badge: form.badge || null,
    badge_tone: form.badge_tone || null,
    featured: Boolean(form.featured),
    published_at: form.published_at ? new Date(form.published_at).toISOString() : new Date().toISOString(),
    is_read: false,
    image_url: imageUrl || product?.image_url || collectionImage || null,
    product: productPreview,
    collection: collectionPreview,
    notice_level: form.kind === 'notice' ? form.notice_level : null
  };

  return (
    <div className="mural-admin-phone" aria-label="Pré-visualização mobile">
      <div className="mural-admin-phone-head"><b>Mural NISTI</b><span>Visual do operador</span></div>
      <div className="mural-admin-shared-preview">
        <MuralCard item={previewItem} onOpen={() => {}} eager />
      </div>
    </div>
  );
}

function PostEditor({ item, collections, catalogProducts = [], onClose, onSaved }) {
  const sourceItem = item && item.mode === 'new' ? null : item;
  const [form, setForm] = useState(() => postForm(sourceItem));
  const [products, setProducts] = useState([]);
  const [productQuery, setProductQuery] = useState(sourceItem?.product_sku || '');
  const [selectedProduct, setSelectedProduct] = useState(sourceItem?.product_id ? {
    id:sourceItem.product_id,
    sku:sourceItem.product_sku,
    nome:sourceItem.product_name,
    miolo_code:sourceItem.product_miolo_code,
    type:sourceItem.product_type,
    image_url:sourceItem.product_image_url,
    wireo:sourceItem.product_wireo,
    tassel:sourceItem.product_tassel,
    elastico:sourceItem.product_elastico,
    collection_name:sourceItem.product_collection_name
  } : null);
  const [image, setImage] = useState(() => sourceItem?.prefillImage || null);
  const [imageUrl, setImageUrl] = useState(() => {
    if (sourceItem?.prefillImage) return URL.createObjectURL(sourceItem.prefillImage);
    if (sourceItem?.image_key) return `/api/admin/mural/posts/${sourceItem.id}/image?v=${encodeURIComponent(sourceItem.image_key)}`;
    return '';
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (form.kind !== 'product') return;
    const timer = setTimeout(() => {
      request(`/api/admin/mural/products?q=${encodeURIComponent(productQuery)}`)
        .then(data => setProducts(data.items || [])).catch(() => setProducts([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [productQuery, form.kind]);

  useEffect(() => () => { if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl); }, [imageUrl]);


  const selectedCollection = collections.find(row => Number(row.id) === Number(form.collection_id));
  const selectedCollectionProducts = String(selectedCollection?.product_ids || '')
    .split(',')
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0)
    .map(id => catalogProducts.find(product => Number(product.id) === id))
    .filter(Boolean);
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));

  const changeKind = nextKind => {
    setForm(current => ({ ...current, kind:nextKind, product_id:'', collection_id:'' }));
    setSelectedProduct(null);
    setProductQuery('');
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

  const removeImage = async () => {
    setError('');
    if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    setImage(null);
    if (!sourceItem?.id || !sourceItem?.image_key) { setImageUrl(''); return; }
    setBusy(true);
    try {
      await request(`/api/admin/mural/posts/${sourceItem.id}/image`, { method:'DELETE' });
      setImageUrl('');
      sourceItem.image_key = null;
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const payload = () => ({
    ...form,
    product_id: form.kind === 'product' ? Number(form.product_id) || null : null,
    collection_id: form.kind === 'collection' ? Number(form.collection_id) || null : null,
    notice_level: form.kind === 'notice' ? form.notice_level : null,
    priority: Number(form.priority) || 0,
    published_at: form.published_at ? new Date(form.published_at).toISOString() : null,
    expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null
  });

  const save = async publish => {
    setBusy(true); setError('');
    try {
      const body = JSON.stringify(payload());
      let id = sourceItem?.id;
      if (id) await request(`/api/admin/mural/posts/${id}`, { method:'PUT', headers:{'content-type':'application/json'}, body });
      else {
        const created = await request('/api/admin/mural/posts', { method:'POST', headers:{'content-type':'application/json'}, body });
        id = created.id;
      }
      if (image) {
        const formData = new FormData(); formData.append('image', image);
        await request(`/api/admin/mural/posts/${id}/image`, { method:'POST', body:formData });
      }
      if (publish) {
        await request(`/api/admin/mural/posts/${id}/publish`, {
          method:'POST', headers:{'content-type':'application/json'},
          body:JSON.stringify({ published_at: form.published_at ? new Date(form.published_at).toISOString() : null })
        });
      }
      await onSaved();
      onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const publishLabel = form.published_at && new Date(form.published_at) > new Date() ? 'Agendar' : 'Publicar';

  return (
    <section className="mural-publisher-workspace" aria-label="Editor de publicação do Mural">
      <nav className="mural-publisher-breadcrumb" aria-label="Navegação">
        <button type="button" onClick={onClose}>Mural NISTI</button><span>›</span><button type="button" onClick={onClose}>Publicações</button><span>›</span><strong>{sourceItem ? 'Editar publicação' : 'Nova publicação'}</strong>
      </nav>

      <header className="mural-publisher-header">
        <div className="mural-publisher-title">
          <span className="mural-publisher-title-icon"><AdminMuralIcon name="sparkles" size={23}/></span>
          <span><h2>{sourceItem ? 'Editar publicação' : 'Nova publicação'}</h2><p>Crie uma novidade, coleção ou aviso para os operadores.</p></span>
        </div>
        <div className="mural-publisher-header-actions">
          <button type="button" className="mural-publisher-secondary" onClick={onClose}><AdminMuralIcon name="back" size={16}/> Voltar</button>
          <button type="submit" form="mural-publication-form" disabled={busy}>Salvar rascunho</button>
          <button type="button" className="primary" disabled={busy} onClick={()=>save(true)}><AdminMuralIcon name="sparkles" size={16}/> {publishLabel}</button>
        </div>
      </header>

      <div className="mural-publisher-layout">
        <form id="mural-publication-form" className="mural-publisher-form" onSubmit={event => { event.preventDefault(); save(false); }}>
          <section className="mural-publisher-block">
            <div className="mural-publisher-block-title"><strong>Tipo de publicação</strong><span>Escolha como o conteúdo será apresentado no Mural.</span></div>
            <div className="mural-publisher-type-grid">
              {[
                ['product','product','Produto','Destaque um produto específico.'],
                ['collection','collection','Coleção','Destaque uma coleção de produtos.'],
                ['notice','notice','Aviso','Comunicado para operadores.']
              ].map(([value,icon,label,description])=>(
                <button type="button" key={value} className={form.kind===value?'active':''} onClick={()=>changeKind(value)}>
                  <span><AdminMuralIcon name={icon} size={25}/></span>
                  <b>{label}</b>
                  <small>{description}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="mural-publisher-block">
            <label className="mural-publisher-field">Título <em>*</em><input maxLength="90" required value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Ex.: Nova Coleção 2027"/></label>
            <label className="mural-publisher-field">Subtítulo<input maxLength="120" value={form.subtitle || ''} onChange={e=>set('subtitle',e.target.value)} placeholder="Uma frase curta para o card e o destaque."/></label>
            <label className="mural-publisher-field">Descrição<textarea maxLength="700" rows="5" value={form.body || ''} onChange={e=>set('body',e.target.value)} placeholder="Conte o que os operadores precisam saber."/><small>{String(form.body || '').length}/700</small></label>
          </section>

          {form.kind === 'product' && (
            <section className="mural-publisher-block">
              <div className="mural-publisher-block-title"><strong>Produto</strong><span>Selecione a referência real do catálogo.</span></div>
              <label className="mural-publisher-field">Buscar produto<input value={productQuery} onChange={e=>setProductQuery(e.target.value)} placeholder="Buscar por SKU ou nome"/></label>
              <div className="mural-publisher-product-search">
                {products.map(product=>(
                  <button type="button" className={Number(form.product_id)===Number(product.id)?'selected':''} key={product.id} onClick={()=>{set('product_id',product.id);setSelectedProduct(product);setProductQuery(product.sku);}}>
                    {product.image_url ? <TransparentMuralProductImage src={product.image_url} alt="" ariaHidden/> : <span className="placeholder"><AdminMuralIcon name="product" size={22}/></span>}
                    <span><b>{product.sku}</b><small>{product.nome || product.variacao || product.type || 'Produto NISTI'}</small></span>
                    {Number(form.product_id)===Number(product.id)&&<i><AdminMuralIcon name="check" size={14}/></i>}
                  </button>
                ))}
              </div>
              <div className="mural-product-visual-standard">
                <span>PADRÃO VISUAL</span>
                <strong>Product Hero Card</strong>
                <small>Banner 2:1 · texto à esquerda · exatamente 1 produto real à direita · foco total no produto.</small>
              </div>
            </section>
          )}

          {form.kind === 'collection' && (
            <section className="mural-publisher-block">
              <label className="mural-publisher-field">Coleção <em>*</em><select value={form.collection_id} onChange={e=>set('collection_id',e.target.value)}><option value="">Selecione</option>{collections.filter(c=>c.status==='active').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              {selectedCollection && (
                <div className="mural-publisher-collection-products">
                  <header><span><b>Produtos da coleção</b><small>{selectedCollectionProducts.length || selectedCollection.product_count || 0} produtos vinculados</small></span><em>Ordem definida na coleção</em></header>
                  <div>
                    {selectedCollectionProducts.length ? selectedCollectionProducts.map((product,index)=>(
                      <figure key={product.id}>
                        {product.image_url ? <TransparentMuralProductImage src={product.image_url} alt={product.nome || product.sku}/> : <span><AdminMuralIcon name="product" size={24}/></span>}
                        <figcaption><b>{product.sku}</b><small>{index+1}</small></figcaption>
                      </figure>
                    )) : <p>Esta coleção ainda não possui produtos carregados na visão atual.</p>}
                  </div>
                </div>
              )}
            </section>
          )}

          {form.kind === 'notice' && (
            <section className="mural-publisher-block">
              <label className="mural-publisher-field">Prioridade visual<select value={form.notice_level} onChange={e=>set('notice_level',e.target.value)}><option value="important">Importante</option><option value="attention">Atenção</option><option value="info">Informação</option></select></label>
            </section>
          )}

          <section className="mural-publisher-block">
            <div className="mural-publisher-block-title"><strong>Exibição</strong><span>Controle selos, destaque e ordem editorial.</span></div>
            <div className="mural-publisher-display-grid">
              <label className="mural-publisher-field">Selo direito<input maxLength="40" value={form.badge || ''} onChange={e=>set('badge',e.target.value)} placeholder="NOVO"/></label>
              <label className="mural-publisher-field">Prioridade<input type="number" min="0" max="100" value={form.priority} onChange={e=>set('priority',e.target.value)}/></label>
              <label className="mural-publisher-featured"><input type="checkbox" checked={form.featured} onChange={e=>set('featured',e.target.checked)}/><span><b>Destaque no topo</b><small>Mostra a publicação no hero principal.</small></span></label>
            </div>
          </section>

          <section className="mural-publisher-block mural-publisher-schedule">
            <div className="mural-publisher-block-title"><strong>Publicação e expiração</strong><span>Opcional. Sem data, o botão Publicar entra imediatamente.</span></div>
            <div className="mural-admin-inline">
              <label className="mural-publisher-field">Publicar em<input type="datetime-local" value={form.published_at} onChange={e=>set('published_at',e.target.value)}/></label>
              <label className="mural-publisher-field">Expira em<input type="datetime-local" value={form.expires_at} onChange={e=>set('expires_at',e.target.value)}/></label>
            </div>
          </section>

          <section className="mural-publisher-block">
            <div className="mural-publisher-block-title"><strong>Imagem editorial manual</strong><span>Envie uma arte pronta para a publicação.</span></div>
            <label className="mural-publisher-upload">
              <AdminMuralIcon name="image" size={24}/>
              <span><b>Selecionar imagem</b><small>JPEG, PNG ou WebP · até 5 MB após compressão</small></span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>chooseImage(e.target.files?.[0])}/>
            </label>
            {(imageUrl || image) && <button type="button" className="mural-admin-remove-image" disabled={busy} onClick={removeImage}>Remover imagem editorial</button>}
          </section>

          {error && <div className="mural-admin-error">{error}</div>}
        </form>

        <aside className="mural-publisher-art-panel">
          <header><span><h3>Arte da publicação</h3><p>Revise o visual antes de salvar ou publicar.</p></span><span className="mural-publisher-art-help">?</span></header>
          <div className="mural-publisher-preview-pane">
            <MobilePreview form={form} product={selectedProduct} collection={selectedCollection} imageUrl={imageUrl}/>
            {imageUrl && <div className="mural-publisher-current-art"><span>Imagem editorial aplicada</span><img src={imageUrl} alt="Imagem editorial atual"/></div>}
          </div>
        </aside>
      </div>

      <footer className="mural-publisher-mobile-actions">
        <button type="submit" form="mural-publication-form" disabled={busy}>Salvar rascunho</button>
        <button type="button" className="primary" disabled={busy} onClick={()=>save(true)}>{publishLabel}</button>
      </footer>
    </section>
  );
}

function CollectionEditor({ item, products, onClose, onSaved }) {
  const [form,setForm]=useState({name:item?.name||'',slug:item?.slug||'',year:item?.year||'',description:item?.description||'',status:item?.status||'active'});
  const [selected,setSelected]=useState(()=>String(item?.product_ids||'').split(',').map(Number).filter(id=>Number.isInteger(id)&&id>0));
  const [image,setImage]=useState(null);
  const [storedImageKey,setStoredImageKey]=useState(item?.image_key||'');
  const [imageUrl,setImageUrl]=useState(item?.image_key ? `/api/admin/mural/collections/${item.id}/image?v=${encodeURIComponent(item.image_key)}` : '');
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const filtered=products.filter(p=>!query||`${p.sku} ${p.nome||''}`.toLowerCase().includes(query.toLowerCase())).slice(0,30);
  const toggle=id=>setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);
  const move=(id,direction)=>setSelected(current=>{
    const index=current.indexOf(id);const target=index+direction;
    if(index<0||target<0||target>=current.length)return current;
    const next=[...current];[next[index],next[target]]=[next[target],next[index]];return next;
  });
  const selectedProducts=selected.map(id=>products.find(product=>product.id===id)).filter(Boolean);
  useEffect(()=>()=>{if(imageUrl.startsWith('blob:'))URL.revokeObjectURL(imageUrl)},[imageUrl]);
  const chooseBanner=async file=>{
    setError('');
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setError('Use JPEG, PNG ou WebP.');return}
    try{
      const prepared=await compressImage(file);
      if(prepared.size>5*1024*1024)throw new Error('A imagem final excede 5 MB.');
      if(imageUrl.startsWith('blob:'))URL.revokeObjectURL(imageUrl);
      setImage(prepared);setImageUrl(URL.createObjectURL(prepared));
    }catch(err){setError(err.message)}
  };
  const removeBanner=async()=>{
    setError('');
    if(imageUrl.startsWith('blob:'))URL.revokeObjectURL(imageUrl);
    setImage(null);
    if(!item?.id||!storedImageKey){setImageUrl('');return}
    setBusy(true);
    try{
      await request(`/api/admin/mural/collections/${item.id}/image`,{method:'DELETE'});
      setStoredImageKey('');setImageUrl('');
    }catch(err){setError(err.message)}finally{setBusy(false)}
  };
  const save=async(publish=false)=>{
    setBusy(true);setError('');
    try{
      const opts={method:item?'PUT':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(form)};
      const data=await request(item?`/api/admin/mural/collections/${item.id}`:'/api/admin/mural/collections',opts);
      const id=item?.id||data.id;
      await request(`/api/admin/mural/collections/${id}/products`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({product_ids:selected})});
      if(image){const fd=new FormData();fd.append('image',image);await request(`/api/admin/mural/collections/${id}/image`,{method:'POST',body:fd});}
      if(publish){
        await request(`/api/admin/mural/collections/${id}/publish`,{method:'POST'});
      }
      await onSaved();onClose();
    }catch(err){setError(err.message)}finally{setBusy(false)}
  };
  return <div className="mural-admin-modal" role="dialog" aria-modal="true"><div className="mural-admin-editor compact"><header><h2>{item?'Editar coleção':'Nova coleção'}</h2><button onClick={onClose}>×</button></header><div className="mural-admin-collection-form">
    <div className="mural-collection-visual-standard"><span>PADRÃO VISUAL DO MURAL</span><strong>Collection Launch Hero Card</strong><small>Mesmo visual do mockup: banner horizontal 2:1, selo NOVA COLEÇÃO automático, nome + ano + frase curta e capas reais da coleção. O Mural público continua bloqueado; a publicação é visível somente no QA.</small></div>
    <label>Nome<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><div className="mural-admin-inline"><label>Slug<input value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})}/></label><label>Ano<input type="number" value={form.year} onChange={e=>setForm({...form,year:e.target.value})}/></label></div>
    <label>Frase / descrição da coleção<textarea rows="4" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/><small>Quando houver texto, o início desta descrição será usado como frase curta no Hero Card da coleção.</small></label>
    <label>Banner da coleção<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>chooseBanner(e.target.files?.[0])}/><small>JPEG, PNG ou WebP; até 5 MB após compressão.</small></label>
    {imageUrl&&<div className="mural-admin-banner-preview"><img src={imageUrl} alt={form.name||'Banner da coleção'}/><button type="button" disabled={busy} onClick={removeBanner}>Remover banner</button></div>}
    {item&&<label>Status<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="active">Ativa</option><option value="archived">Arquivada</option></select></label>}
    <label>Produtos<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar SKU ou nome"/></label>
    {selectedProducts.length>0&&<div className="mural-admin-selected-products" aria-label="Ordem editorial dos produtos"><strong>Ordem editorial</strong>{selectedProducts.map((p,index)=><div key={p.id}><span>{index+1}. {p.sku} · {p.nome||'Produto NISTI'}</span><div><button type="button" disabled={index===0} onClick={()=>move(p.id,-1)} aria-label={`Mover ${p.sku} para cima`}>↑</button><button type="button" disabled={index===selectedProducts.length-1} onClick={()=>move(p.id,1)} aria-label={`Mover ${p.sku} para baixo`}>↓</button></div></div>)}</div>}
    <div className="mural-admin-product-grid">{filtered.map(p=><button type="button" className={selected.includes(p.id)?'selected':''} key={p.id} onClick={()=>toggle(p.id)}><b>{p.sku}</b><span>{p.nome}</span></button>)}</div>
    {error&&<div className="mural-admin-error">{error}</div>}<div className="mural-admin-actions"><button type="button" onClick={onClose}>Cancelar</button><button type="button" disabled={busy||!form.name} onClick={()=>save(false)}>Salvar coleção</button><button type="button" className="primary" disabled={busy||!form.name||selected.length===0} onClick={()=>save(true)}>{busy?'Processando…':'Salvar e publicar no Mural QA'}</button></div>
  </div></div></div>;
}

export default function MuralNistiAdminView() {
  const [section,setSection]=useState('posts');
  const [posts,setPosts]=useState([]);
  const [collections,setCollections]=useState([]);
  const [products,setProducts]=useState([]);
  const [editor,setEditor]=useState(null);
  const [collectionEditor,setCollectionEditor]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [metrics,setMetrics]=useState(null);
  const [readiness,setReadiness]=useState(null);

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [p,c,prod]=await Promise.all([
        request('/api/admin/mural/posts'),
        request('/api/admin/mural/collections'),
        request('/api/admin/mural/products?limit=500')
      ]);
      setPosts(p.items||[]);setCollections(c.items||[]);setProducts(prod.items||[]);
    }catch(err){setError(err.message)}finally{setLoading(false)}
  };
  const refreshReadiness=async()=>{
    try{setReadiness(await request('/api/admin/mural/readiness'))}catch{setReadiness(null)}
  };
  useEffect(()=>{load()},[]);
  useEffect(()=>{request('/api/admin/mural/metrics').then(setMetrics).catch(()=>setMetrics(null))},[]);
  useEffect(()=>{refreshReadiness()},[]);

  const action=async(id,name)=>{
    try{setError('');await request(`/api/admin/mural/posts/${id}/${name}`,{method:'POST'});await load();await refreshReadiness()}catch(err){setError(err.message)}
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
      await refreshReadiness();
    }catch(err){
      setError(err.message);
    }
  };

  if (editor) {
    return <PostEditor
      item={editor}
      collections={collections}
      catalogProducts={products}
      onClose={()=>setEditor(null)}
      onSaved={async()=>{await load();await refreshReadiness()}}
    />;
  }

  return <section className="mural-admin-view mural-admin-dashboard">
    <header className="mural-admin-dashboard-header">
      <div className="mural-admin-dashboard-title">
        <span className="icon"><AdminMuralIcon name="user" size={22}/></span>
        <span><h2>Conteúdo para operadores</h2><p>Crie, gerencie e publique produtos, coleções e avisos que serão exibidos no Mural.</p></span>
      </div>
      <div className="mural-admin-dashboard-actions">
        <button type="button" className="qa" onClick={()=>window.location.assign('/?mural=qa')}>Abrir Mural QA</button>
        {section==='posts'&&<button className="primary" onClick={()=>setEditor({mode:'new'})}>+ Nova publicação</button>}
        {section==='collections'&&<button className="primary" onClick={()=>setCollectionEditor({mode:'new'})}>+ Nova coleção</button>}
      </div>
    </header>
    <div className="mural-admin-manager-nav">
      <div>
        <button className={section==='posts'?'active':''} onClick={()=>setSection('posts')}>Publicações</button>
        <button className={section==='collections'?'active':''} onClick={()=>setSection('collections')}>Coleções</button>
        <button className={section==='images'?'active':''} onClick={()=>setSection('images')}>Imagens dos produtos</button>
        <button className={section==='metrics'?'active':''} onClick={()=>setSection('metrics')}>Métricas</button>
        <button className={section==='qa'?'active':''} onClick={()=>setSection('qa')}>QA de liberação</button>
      </div>
      <span className="mural-admin-private-badge">QA privado · público em “Em breve”</span>
    </div>
    {error&&<div className="mural-admin-error">{error}</div>}
    {section==='posts'&&<MuralPublicationsDashboard
      posts={posts}
      collections={collections}
      loading={loading}
      onEdit={setEditor}
      onAction={action}
      onPush={sendPush}
      onDelete={deletePost}
    />}
    {section==='collections'&&<div className="mural-admin-collections">{collections.map(row=><article key={row.id}><div><Status value={row.status==='active'?'published':'archived'}/><h3>{row.name}</h3><p>{row.description||'Sem descrição.'}</p><small>{row.product_count||0} produtos · {row.year||'sem ano'}</small></div><button onClick={()=>setCollectionEditor(row)}>Editar</button></article>)}{!loading&&!collections.length&&<div className="mural-admin-empty">Nenhuma coleção cadastrada.</div>}</div>}
    {section==='images'&&<MuralProductImageManager products={products} onChanged={load}/>}
    {section==='metrics'&&<div className="mural-admin-metrics"><article><small>OPERADORES COM LEITURA</small><strong>{metrics?.readers ?? '—'}</strong></article><article><small>IMAGEM EDITORIAL MÉDIA</small><strong>{metrics?.editorial_images?.average_bytes ? `${Math.round(metrics.editorial_images.average_bytes/1024)} KB` : '0 KB'}</strong><span>{metrics?.editorial_images?.count ?? 0} imagens</span></article><article><small>PUBLICAÇÕES NO MÊS</small><strong>{metrics?.published_by_month?.[0]?.total ?? 0}</strong><span>{metrics?.published_by_month?.[0]?.month || 'Sem publicações'}</span></article><div className="mural-admin-metric-list"><h3>Posts com mais leituras</h3>{metrics?.top_reads?.length?metrics.top_reads.map(row=><div key={row.id}><span>{row.title}</span><b>{row.reads}</b></div>):<p>Sem leituras registradas.</p>}</div></div>}
    {section==='qa'&&<div className="mural-admin-readiness">
      <div className="mural-admin-readiness-summary">
        <div><small>READINESS AUTOMÁTICO</small><strong>{readiness?.automated_ready?'Pronto para smoke':'Pendências detectadas'}</strong><p>Valida o ambiente atual sem remover o gate público do Mural.</p></div>
        <div className="mural-admin-readiness-summary-actions"><ReadinessBadge ok={Boolean(readiness?.automated_ready)} unknown={!readiness}/><button type="button" onClick={refreshReadiness}>Atualizar diagnóstico</button></div>
      </div>
      <div className="mural-admin-readiness-grid">
        <article><div><small>MIGRATION D1</small><strong>{readiness?.migration?.ok?'Estrutura presente':'Estrutura incompleta'}</strong></div><ReadinessBadge ok={Boolean(readiness?.migration?.ok)} unknown={!readiness}/>{readiness?.migration?.missing_tables?.length>0&&<p>Faltando: {readiness.migration.missing_tables.join(', ')}</p>}</article>
        <article><div><small>CONTEÚDO PARA QA</small><strong>{readiness?.content?.published_now ?? '—'} publicados agora</strong></div><ReadinessBadge ok={Boolean(readiness?.content?.ok)} unknown={!readiness}/><p>Meta mínima: {readiness?.content?.minimum_for_qa ?? 3}. Produto {readiness?.content?.by_kind?.product ?? 0} · Coleção {readiness?.content?.by_kind?.collection ?? 0} · Aviso {readiness?.content?.by_kind?.notice ?? 0}.</p></article>
        <article><div><small>PRIMEIRA DOBRA</small><strong>{formatBytes(readiness?.images?.first_fold_bytes)} / {formatBytes(readiness?.images?.first_fold_budget_bytes)}</strong></div><ReadinessBadge ok={Boolean(readiness?.images?.ok)} unknown={!readiness || !readiness?.images?.available}/><p>Soma do hero + primeiros cards, usando os objetos reais do R2 quando disponíveis.</p></article>
      </div>
      <div className="mural-admin-readiness-list">
        <h3>Imagens da primeira dobra</h3>
        {readiness?.images?.items?.length?readiness.images.items.map(item=><div key={item.id}><span><b>{item.title}</b><small>{item.role} · {item.kind}</small></span><span>{formatBytes(item.bytes)} / {formatBytes(item.budget_bytes)}</span><ReadinessBadge ok={item.within_budget!==false} unknown={item.within_budget===null}/></div>):<p>Nenhuma imagem mensurável na primeira dobra.</p>}
      </div>
      <div className="mural-admin-readiness-manual"><strong>Ainda exige validação real</strong><p>Scanner → Mural → Scanner com reinício da câmera, breakpoints 360/390/430 px, safe-area no iPhone e abertura abaixo de 1 s continuam sendo smoke tests em aparelho real.</p></div>
    </div>}

    {collectionEditor&&<CollectionEditor item={collectionEditor.mode==='new'?null:collectionEditor} products={products} onClose={()=>setCollectionEditor(null)} onSaved={async()=>{await load();await refreshReadiness()}}/>}
  </section>;
}
