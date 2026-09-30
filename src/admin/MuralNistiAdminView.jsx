import React, { useEffect, useMemo, useState } from 'react';
import '../mural-admin.css';
import { MuralCard } from '../mural-nisti.jsx';
import { productTypeLabel } from '../product-display.js';

const EMPTY_POST = {
  kind: 'notice', title: '', subtitle: '', body: '', badge: 'NOVO', badge_tone: 'success',
  product_id: '', collection_id: '', notice_level: 'info', featured: false, priority: 0,
  published_at: '', expires_at: ''
};

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`);
  return data;
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

function base64ToFile(base64, mimeType = 'image/png', name = 'mural-ai.png') {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type:mimeType });
}

async function prepareAiImage(file, mode) {
  if (!file) return file;
  if (mode === 'remove_background') return compressImage(file);
  const bitmap = await createImageBitmap(file);
  const maxWidth = 1280;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha:false });
  context.fillStyle = '#ffffff';
  context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.80));
  if (!blob) throw new Error('Não foi possível otimizar a arte gerada.');
  return new File([blob],'mural-ai-scene.jpg',{type:'image/jpeg'});
}

function Status({ value }) {
  const labels = { draft: 'Rascunho', published: 'Publicado', archived: 'Arquivado' };
  return <span className={`mural-admin-status ${value}`}>{labels[value] || value}</span>;
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

function PostEditor({ item, collections, onClose, onSaved }) {
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
  const [image, setImage] = useState(null);
  const [imageUrl, setImageUrl] = useState(sourceItem?.image_key ? `/api/admin/mural/posts/${sourceItem.id}/image?v=${encodeURIComponent(sourceItem.image_key)}` : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiStyle, setAiStyle] = useState('editorial');
  const [aiResult, setAiResult] = useState(null);

  useEffect(() => {
    if (form.kind !== 'product') return;
    const timer = setTimeout(() => {
      request(`/api/admin/mural/products?q=${encodeURIComponent(productQuery)}`)
        .then(data => setProducts(data.items || [])).catch(() => setProducts([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [productQuery, form.kind]);

  useEffect(() => () => { if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl); }, [imageUrl]);
  useEffect(() => () => { if (aiResult?.url?.startsWith('blob:')) URL.revokeObjectURL(aiResult.url); }, [aiResult]);

  const selectedCollection = collections.find(row => Number(row.id) === Number(form.collection_id));
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));

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

  const generateAiArt = async mode => {
    setAiError('');
    if (form.kind === 'product' && !Number(form.product_id)) {
      setAiError('Selecione o produto que será usado como referência visual.');
      return;
    }
    if (form.kind === 'collection' && !Number(form.collection_id)) {
      setAiError('Selecione a coleção que será usada como referência visual.');
      return;
    }
    setAiBusy(true);
    try {
      const data = await request('/api/admin/mural/ai-art', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          mode,
          kind:form.kind,
          product_id:Number(form.product_id) || null,
          collection_id:Number(form.collection_id) || null,
          title:form.title,
          subtitle:form.subtitle,
          style:aiStyle,
          prompt:aiPrompt
        })
      });
      const raw = base64ToFile(
        data.image_base64,
        data.mime_type || 'image/png',
        mode === 'remove_background' ? 'produto-sem-fundo.png' : 'mural-arte-ia.png'
      );
      const prepared = await prepareAiImage(raw, mode);
      if (prepared.size > 5 * 1024 * 1024) throw new Error('A arte gerada excedeu 5 MB após otimização.');
      if (aiResult?.url?.startsWith('blob:')) URL.revokeObjectURL(aiResult.url);
      const url = URL.createObjectURL(prepared);
      setAiResult({
        file:prepared,
        url,
        mode,
        model:data.model || 'gemini-3.1-flash-image',
        sourceCount:Number(data.source_count || 0),
        synthid:Boolean(data.synthid)
      });
    } catch (err) {
      setAiError(err.message || 'Não foi possível gerar a arte.');
    } finally {
      setAiBusy(false);
    }
  };

  const applyAiResult = () => {
    if (!aiResult?.file) return;
    if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    setImage(aiResult.file);
    setImageUrl(URL.createObjectURL(aiResult.file));
    if (aiResult.url?.startsWith('blob:')) URL.revokeObjectURL(aiResult.url);
    setAiResult(null);
  };

  const discardAiResult = () => {
    if (aiResult?.url?.startsWith('blob:')) URL.revokeObjectURL(aiResult.url);
    setAiResult(null);
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

  return (
    <div className="mural-admin-modal" role="dialog" aria-modal="true" aria-label="Editor do Mural">
      <div className="mural-admin-editor">
        <header><div><small>MURAL NISTI</small><h2>{sourceItem ? 'Editar publicação' : 'Nova publicação'}</h2></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
        <div className="mural-admin-editor-grid">
          <form onSubmit={event => { event.preventDefault(); save(false); }}>
            <label>Tipo<select value={form.kind} onChange={e => { set('kind',e.target.value); set('product_id',''); set('collection_id',''); }}><option value="product">Produto</option><option value="collection">Coleção</option><option value="notice">Aviso</option></select></label>
            {form.kind === 'product' && <label>Produto<input value={productQuery} onChange={e=>setProductQuery(e.target.value)} placeholder="Buscar SKU ou nome" />
              <div className="mural-admin-picker">{products.map(product => <button type="button" className={Number(form.product_id)===Number(product.id)?'selected':''} key={product.id} onClick={()=>{set('product_id',product.id);setSelectedProduct(product);setProductQuery(product.sku);}}><b>{product.sku}</b><span>{product.nome || product.variacao || ''}</span></button>)}</div>
            </label>}
            {form.kind === 'collection' && <label>Coleção<select value={form.collection_id} onChange={e=>set('collection_id',e.target.value)}><option value="">Selecione</option>{collections.filter(c=>c.status==='active').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
            {form.kind === 'notice' && <label>Prioridade visual<select value={form.notice_level} onChange={e=>set('notice_level',e.target.value)}><option value="important">Importante</option><option value="attention">Atenção</option><option value="info">Informação</option></select></label>}
            <label>Título<input maxLength="90" required value={form.title} onChange={e=>set('title',e.target.value)} /></label>
            <label>Subtítulo<input maxLength="120" value={form.subtitle || ''} onChange={e=>set('subtitle',e.target.value)} /></label>
            <label>Texto<textarea maxLength="700" rows="5" value={form.body || ''} onChange={e=>set('body',e.target.value)} /></label>
            <div className="mural-admin-inline"><label>Selo<input maxLength="40" value={form.badge || ''} onChange={e=>set('badge',e.target.value)} /></label><label>Prioridade<input type="number" min="0" max="100" value={form.priority} onChange={e=>set('priority',e.target.value)} /></label></div>
            <label className="mural-admin-check"><input type="checkbox" checked={form.featured} onChange={e=>set('featured',e.target.checked)} /> Destaque no topo</label>
            <div className="mural-admin-inline"><label>Publicar em<input type="datetime-local" value={form.published_at} onChange={e=>set('published_at',e.target.value)} /></label><label>Expira em<input type="datetime-local" value={form.expires_at} onChange={e=>set('expires_at',e.target.value)} /></label></div>
            <label>Imagem editorial<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>chooseImage(e.target.files?.[0])} /><small>JPEG, PNG ou WebP. Compressão no cliente até 1600 px; máximo 5 MB.</small></label>
            {(imageUrl || image) && <button type="button" className="mural-admin-remove-image" disabled={busy} onClick={removeImage}>Remover imagem editorial</button>}

            <section className="mural-admin-ai-studio" aria-label="Estúdio de IA do Mural">
              <header>
                <div><small>IA DE IMAGEM</small><strong>Nano Banana</strong></div>
                <span>Gemini</span>
              </header>
              <p>Crie a arte editorial usando os produtos reais como referência. A IA recebe as imagens do catálogo e deve preservar capa, estampa, textos, cores e acabamentos.</p>
              <div className="mural-admin-ai-source">
                <b>Fonte</b>
                <span>
                  {form.kind === 'product'
                    ? selectedProduct ? `${selectedProduct.sku} · ${selectedProduct.nome || selectedProduct.type || 'Produto'}` : 'Selecione um produto'
                    : form.kind === 'collection'
                      ? selectedCollection ? selectedCollection.name : 'Selecione uma coleção'
                      : 'Arte sem produto de referência'}
                </span>
              </div>
              <label>Direção visual
                <select value={aiStyle} onChange={e=>setAiStyle(e.target.value)}>
                  <option value="editorial">Editorial premium</option>
                  <option value="cozy">Mesa criativa / aconchegante</option>
                  <option value="minimal">Estúdio minimalista</option>
                  <option value="floral">Floral sofisticado</option>
                  <option value="colorful">Colorido criativo</option>
                </select>
              </label>
              <label>Briefing criativo
                <textarea
                  rows="3"
                  maxLength="900"
                  value={aiPrompt}
                  onChange={e=>setAiPrompt(e.target.value)}
                  placeholder="Ex.: mesa rosé, flores discretas, caneta dourada, luz natural lateral e espaço limpo à esquerda para o título."
                />
              </label>
              <div className="mural-admin-ai-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={aiBusy || (form.kind === 'product' && !form.product_id) || (form.kind === 'collection' && !form.collection_id)}
                  onClick={()=>generateAiArt('creative_scene')}
                >
                  {aiBusy ? 'Gerando…' : 'Criar arte com cenário'}
                </button>
                {form.kind === 'product' && (
                  <button
                    type="button"
                    disabled={aiBusy || !form.product_id}
                    onClick={()=>generateAiArt('remove_background')}
                  >
                    Remover fundo branco
                  </button>
                )}
              </div>
              <small className="mural-admin-ai-note">A geração usa Nano Banana e não publica automaticamente. Revise a arte antes de aplicar. Imagens geradas pelo Gemini incluem SynthID.</small>
              {aiError && <div className="mural-admin-ai-error">{aiError}</div>}
              {aiResult && (
                <div className="mural-admin-ai-result">
                  <img src={aiResult.url} alt="Arte gerada por IA para revisão" />
                  <div>
                    <span><b>{aiResult.mode === 'remove_background' ? 'Produto isolado' : 'Cenário editorial'}</b><small>{aiResult.model} · {formatBytes(aiResult.file.size)}</small></span>
                    <div>
                      <button type="button" onClick={discardAiResult}>Descartar</button>
                      <button type="button" className="primary" onClick={applyAiResult}>Usar esta arte</button>
                    </div>
                  </div>
                </div>
              )}
            </section>
            {error && <div className="mural-admin-error">{error}</div>}
            <div className="mural-admin-actions"><button type="button" onClick={onClose}>Cancelar</button><button type="submit" disabled={busy}>Salvar rascunho</button><button type="button" className="primary" disabled={busy} onClick={()=>save(true)}>{form.published_at && new Date(form.published_at)>new Date()?'Agendar':'Publicar agora'}</button></div>
          </form>
          <aside><h3>Preview mobile</h3><MobilePreview form={form} product={selectedProduct} collection={selectedCollection} imageUrl={imageUrl} /></aside>
        </div>
      </div>
    </div>
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
  const save=async()=>{
    setBusy(true);setError('');
    try{
      const opts={method:item?'PUT':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(form)};
      const data=await request(item?`/api/admin/mural/collections/${item.id}`:'/api/admin/mural/collections',opts);
      const id=item?.id||data.id;
      await request(`/api/admin/mural/collections/${id}/products`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({product_ids:selected})});
      if(image){const fd=new FormData();fd.append('image',image);await request(`/api/admin/mural/collections/${id}/image`,{method:'POST',body:fd});}
      await onSaved();onClose();
    }catch(err){setError(err.message)}finally{setBusy(false)}
  };
  return <div className="mural-admin-modal" role="dialog" aria-modal="true"><div className="mural-admin-editor compact"><header><h2>{item?'Editar coleção':'Nova coleção'}</h2><button onClick={onClose}>×</button></header><div className="mural-admin-collection-form">
    <label>Nome<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><div className="mural-admin-inline"><label>Slug<input value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})}/></label><label>Ano<input type="number" value={form.year} onChange={e=>setForm({...form,year:e.target.value})}/></label></div>
    <label>Descrição<textarea rows="4" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
    <label>Banner da coleção<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>chooseBanner(e.target.files?.[0])}/><small>JPEG, PNG ou WebP; até 5 MB após compressão.</small></label>
    {imageUrl&&<div className="mural-admin-banner-preview"><img src={imageUrl} alt={form.name||'Banner da coleção'}/><button type="button" disabled={busy} onClick={removeBanner}>Remover banner</button></div>}
    {item&&<label>Status<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="active">Ativa</option><option value="archived">Arquivada</option></select></label>}
    <label>Produtos<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar SKU ou nome"/></label>
    {selectedProducts.length>0&&<div className="mural-admin-selected-products" aria-label="Ordem editorial dos produtos"><strong>Ordem editorial</strong>{selectedProducts.map((p,index)=><div key={p.id}><span>{index+1}. {p.sku} · {p.nome||'Produto NISTI'}</span><div><button type="button" disabled={index===0} onClick={()=>move(p.id,-1)} aria-label={`Mover ${p.sku} para cima`}>↑</button><button type="button" disabled={index===selectedProducts.length-1} onClick={()=>move(p.id,1)} aria-label={`Mover ${p.sku} para baixo`}>↓</button></div></div>)}</div>}
    <div className="mural-admin-product-grid">{filtered.map(p=><button type="button" className={selected.includes(p.id)?'selected':''} key={p.id} onClick={()=>toggle(p.id)}><b>{p.sku}</b><span>{p.nome}</span></button>)}</div>
    {error&&<div className="mural-admin-error">{error}</div>}<div className="mural-admin-actions"><button onClick={onClose}>Cancelar</button><button className="primary" disabled={busy||!form.name} onClick={save}>Salvar coleção</button></div>
  </div></div></div>;
}

export default function MuralNistiAdminView() {
  const [section,setSection]=useState('posts');
  const [posts,setPosts]=useState([]);
  const [collections,setCollections]=useState([]);
  const [products,setProducts]=useState([]);
  const [status,setStatus]=useState('');
  const [kind,setKind]=useState('');
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
        request(`/api/admin/mural/posts?status=${encodeURIComponent(status)}&kind=${encodeURIComponent(kind)}`),
        request('/api/admin/mural/collections'),
        request('/api/admin/mural/products')
      ]);
      setPosts(p.items||[]);setCollections(c.items||[]);setProducts(prod.items||[]);
    }catch(err){setError(err.message)}finally{setLoading(false)}
  };
  const refreshReadiness=async()=>{
    try{setReadiness(await request('/api/admin/mural/readiness'))}catch{setReadiness(null)}
  };
  useEffect(()=>{load()},[status,kind]);
  useEffect(()=>{request('/api/admin/mural/metrics').then(setMetrics).catch(()=>setMetrics(null))},[]);
  useEffect(()=>{refreshReadiness()},[]);

  const action=async(id,name)=>{
    try{setError('');await request(`/api/admin/mural/posts/${id}/${name}`,{method:'POST'});await load();await refreshReadiness()}catch(err){setError(err.message)}
  };
  const sendPush=async row=>{
    if(!window.confirm(`Enviar notificação deste conteúdo para os dispositivos inscritos?\n\n${row.title}`))return;
    try{setError('');const result=await request(`/api/admin/mural/posts/${row.id}/push`,{method:'POST'});window.alert(`Notificação processada: ${result.sent||0} enviada(s), ${result.failed||0} falha(s).`)}catch(err){setError(err.message)}
  };
  const dates=row=>row.published_at?new Date(row.published_at).toLocaleString('pt-BR'):'—';

  return <section className="mural-admin-view">
    <div className="mural-admin-heading"><div><span>MURAL NISTI</span><h2>Conteúdo para operadores</h2><p>Crie, pré-visualize, agende e publique sem alterar código.</p></div><div className="mural-admin-heading-actions"><button type="button" onClick={()=>window.location.assign('/?mural=qa')}>Abrir Mural QA</button>{section==='posts'&&<button className="primary" onClick={()=>setEditor({mode:'new'})}>+ Nova publicação</button>}{section==='collections'&&<button className="primary" onClick={()=>setCollectionEditor({mode:'new'})}>+ Nova coleção</button>}</div></div>
    <div className="mural-admin-qa-note" role="note"><strong>QA privado</strong><span>O Mural completo só abre em dispositivos com sessão administrativa válida. Operadores continuam vendo “Em breve”.</span></div>
    <div className="mural-admin-section-tabs"><button className={section==='posts'?'active':''} onClick={()=>setSection('posts')}>Publicações</button><button className={section==='collections'?'active':''} onClick={()=>setSection('collections')}>Coleções</button><button className={section==='metrics'?'active':''} onClick={()=>setSection('metrics')}>Métricas</button><button className={section==='qa'?'active':''} onClick={()=>setSection('qa')}>QA de liberação</button></div>
    {error&&<div className="mural-admin-error">{error}</div>}
    {section==='posts'&&<><div className="mural-admin-filters"><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos os status</option><option value="draft">Rascunhos</option><option value="published">Publicados</option><option value="archived">Arquivados</option></select><select value={kind} onChange={e=>setKind(e.target.value)}><option value="">Todos os tipos</option><option value="product">Produto</option><option value="collection">Coleção</option><option value="notice">Aviso</option></select></div>
    <div className="mural-admin-table-wrap"><table><thead><tr><th>Título</th><th>Tipo</th><th>Selo</th><th>Status</th><th>Publicação</th><th>Expiração</th><th>Autor</th><th>Ações</th></tr></thead><tbody>{posts.map(row=><tr key={row.id}><td><b>{row.title}</b><small>{row.subtitle||''}</small></td><td>{row.kind}</td><td>{row.badge||'—'}</td><td><Status value={row.status}/></td><td>{dates(row)}</td><td>{row.expires_at?new Date(row.expires_at).toLocaleString('pt-BR'):'—'}</td><td>{row.created_by||'—'}</td><td><div className="mural-admin-row-actions"><button onClick={()=>setEditor(row)}>Editar</button><button onClick={()=>setEditor(row)}>Pré-visualizar</button><button onClick={()=>action(row.id,'duplicate')}>Duplicar</button>{row.status!=='published'&&<button onClick={()=>action(row.id,'publish')}>Publicar</button>}{row.status!=='archived'&&<button onClick={()=>action(row.id,'archive')}>Arquivar</button>}{row.status==='published'&&((row.kind==='notice'&&row.notice_level==='important')||row.kind==='product')&&<button onClick={()=>sendPush(row)}>Enviar notificação</button>}</div></td></tr>)}</tbody></table>{!loading&&!posts.length&&<div className="mural-admin-empty">Nenhuma publicação encontrada.</div>}</div></>}
    {section==='collections'&&<div className="mural-admin-collections">{collections.map(row=><article key={row.id}><div><Status value={row.status==='active'?'published':'archived'}/><h3>{row.name}</h3><p>{row.description||'Sem descrição.'}</p><small>{row.product_count||0} produtos · {row.year||'sem ano'}</small></div><button onClick={()=>setCollectionEditor(row)}>Editar</button></article>)}{!loading&&!collections.length&&<div className="mural-admin-empty">Nenhuma coleção cadastrada.</div>}</div>}
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

    {editor&&<PostEditor item={editor} collections={collections} onClose={()=>setEditor(null)} onSaved={async()=>{await load();await refreshReadiness()}}/>}
    {collectionEditor&&<CollectionEditor item={collectionEditor.mode==='new'?null:collectionEditor} products={products} onClose={()=>setCollectionEditor(null)} onSaved={async()=>{await load();await refreshReadiness()}}/>}
  </section>;
}
