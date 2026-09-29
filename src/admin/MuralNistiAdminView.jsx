import React, { useEffect, useMemo, useState } from 'react';
import '../mural-admin.css';

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

function postForm(row = EMPTY_POST) {
  return {
    ...EMPTY_POST, ...row,
    product_id: row.product_id || '',
    collection_id: row.collection_id || '',
    featured: Boolean(row.featured),
    published_at: toLocalInput(row.published_at),
    expires_at: toLocalInput(row.expires_at)
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
  return <span className={`mural-admin-status ${value}`}>{labels[value] || value}</span>;
}

function MobilePreview({ form, product, collection, imageUrl }) {
  const title = form.title || 'Título da publicação';
  const subtitle = form.subtitle || (form.kind === 'product' ? product?.sku : form.kind === 'collection' ? collection?.name : 'Orientação operacional');
  return (
    <div className="mural-admin-phone" aria-label="Pré-visualização mobile">
      <div className="mural-admin-phone-head"><b>Mural NISTI</b><span>{form.kind === 'notice' ? 'Aviso' : form.kind === 'product' ? 'Produto' : 'Coleção'}</span></div>
      <article className={`mural-admin-preview-card ${form.featured ? 'featured' : ''}`}>
        {imageUrl ? <img src={imageUrl} alt="" /> : <div className="mural-admin-preview-placeholder">{form.kind === 'notice' ? '!' : 'NISTI'}</div>}
        <div>
          <div className="mural-admin-preview-badges">
            {form.badge && <span>{form.badge}</span>}
            {form.kind === 'notice' && <span>{form.notice_level}</span>}
          </div>
          <h4>{title}</h4>
          {subtitle && <p className="mural-admin-preview-subtitle">{subtitle}</p>}
          {form.body && <p>{form.body}</p>}
          {form.kind === 'product' && product && <small>{product.sku} · {product.nome || 'Produto NISTI'}</small>}
        </div>
      </article>
    </div>
  );
}

function PostEditor({ item, collections, onClose, onSaved }) {
  const [form, setForm] = useState(() => postForm(item));
  const [products, setProducts] = useState([]);
  const [productQuery, setProductQuery] = useState(item?.product_sku || '');
  const [selectedProduct, setSelectedProduct] = useState(item?.product_id ? { id:item.product_id, sku:item.product_sku, nome:item.product_name } : null);
  const [image, setImage] = useState(null);
  const [imageUrl, setImageUrl] = useState(item?.image_key ? `/api/mural/images/${item.id}?v=${encodeURIComponent(item.image_key)}` : '');
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
      let id = item?.id;
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
        <header><div><small>MURAL NISTI</small><h2>{item ? 'Editar publicação' : 'Nova publicação'}</h2></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
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
  const [selected,setSelected]=useState(()=>String(item?.product_ids||'').split(',').map(Number).filter(Number.isInteger));
  const [image,setImage]=useState(null);
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const filtered=products.filter(p=>!query||`${p.sku} ${p.nome||''}`.toLowerCase().includes(query.toLowerCase())).slice(0,30);
  const toggle=id=>setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);
  const save=async()=>{
    setBusy(true);setError('');
    try{
      const opts={method:item?'PUT':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(form)};
      const data=await request(item?`/api/admin/mural/collections/${item.id}`:'/api/admin/mural/collections',opts);
      const id=item?.id||data.id;
      await request(`/api/admin/mural/collections/${id}/products`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({product_ids:selected})});
      if(image){const prepared=await compressImage(image);if(prepared.size>5*1024*1024)throw new Error('A imagem final excede 5 MB.');const fd=new FormData();fd.append('image',prepared);await request(`/api/admin/mural/collections/${id}/image`,{method:'POST',body:fd});}
      await onSaved();onClose();
    }catch(err){setError(err.message)}finally{setBusy(false)}
  };
  return <div className="mural-admin-modal" role="dialog" aria-modal="true"><div className="mural-admin-editor compact"><header><h2>{item?'Editar coleção':'Nova coleção'}</h2><button onClick={onClose}>×</button></header><div className="mural-admin-collection-form">
    <label>Nome<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><div className="mural-admin-inline"><label>Slug<input value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})}/></label><label>Ano<input type="number" value={form.year} onChange={e=>setForm({...form,year:e.target.value})}/></label></div>
    <label>Descrição<textarea rows="4" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
    <label>Banner da coleção<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setImage(e.target.files?.[0]||null)}/><small>JPEG, PNG ou WebP; até 5 MB após compressão.</small></label>
    {item&&<label>Status<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="active">Ativa</option><option value="archived">Arquivada</option></select></label>}
    <label>Produtos<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar SKU ou nome"/></label><div className="mural-admin-product-grid">{filtered.map(p=><button type="button" className={selected.includes(p.id)?'selected':''} key={p.id} onClick={()=>toggle(p.id)}><b>{p.sku}</b><span>{p.nome}</span></button>)}</div>
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
  useEffect(()=>{load()},[status,kind]);

  const action=async(id,name)=>{
    try{setError('');await request(`/api/admin/mural/posts/${id}/${name}`,{method:'POST'});await load()}catch(err){setError(err.message)}
  };
  const dates=row=>row.published_at?new Date(row.published_at).toLocaleString('pt-BR'):'—';

  return <section className="mural-admin-view">
    <div className="mural-admin-heading"><div><span>MURAL NISTI</span><h2>Conteúdo para operadores</h2><p>Crie, pré-visualize, agende e publique sem alterar código.</p></div><button className="primary" onClick={()=>section==='posts'?setEditor({mode:'new'}):setCollectionEditor({mode:'new'})}>+ {section==='posts'?'Nova publicação':'Nova coleção'}</button></div>
    <div className="mural-admin-section-tabs"><button className={section==='posts'?'active':''} onClick={()=>setSection('posts')}>Publicações</button><button className={section==='collections'?'active':''} onClick={()=>setSection('collections')}>Coleções</button></div>
    {error&&<div className="mural-admin-error">{error}</div>}
    {section==='posts'&&<><div className="mural-admin-filters"><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos os status</option><option value="draft">Rascunhos</option><option value="published">Publicados</option><option value="archived">Arquivados</option></select><select value={kind} onChange={e=>setKind(e.target.value)}><option value="">Todos os tipos</option><option value="product">Produto</option><option value="collection">Coleção</option><option value="notice">Aviso</option></select></div>
    <div className="mural-admin-table-wrap"><table><thead><tr><th>Título</th><th>Tipo</th><th>Selo</th><th>Status</th><th>Publicação</th><th>Expiração</th><th>Autor</th><th>Ações</th></tr></thead><tbody>{posts.map(row=><tr key={row.id}><td><b>{row.title}</b><small>{row.subtitle||''}</small></td><td>{row.kind}</td><td>{row.badge||'—'}</td><td><Status value={row.status}/></td><td>{dates(row)}</td><td>{row.expires_at?new Date(row.expires_at).toLocaleString('pt-BR'):'—'}</td><td>{row.created_by||'—'}</td><td><div className="mural-admin-row-actions"><button onClick={()=>setEditor(row)}>Editar</button><button onClick={()=>action(row.id,'duplicate')}>Duplicar</button>{row.status!=='published'&&<button onClick={()=>action(row.id,'publish')}>Publicar</button>}{row.status!=='archived'&&<button onClick={()=>action(row.id,'archive')}>Arquivar</button>}</div></td></tr>)}</tbody></table>{!loading&&!posts.length&&<div className="mural-admin-empty">Nenhuma publicação encontrada.</div>}</div></>}
    {section==='collections'&&<div className="mural-admin-collections">{collections.map(row=><article key={row.id}><div><Status value={row.status==='active'?'published':'archived'}/><h3>{row.name}</h3><p>{row.description||'Sem descrição.'}</p><small>{row.product_count||0} produtos · {row.year||'sem ano'}</small></div><button onClick={()=>setCollectionEditor(row)}>Editar</button></article>)}{!loading&&!collections.length&&<div className="mural-admin-empty">Nenhuma coleção cadastrada.</div>}</div>}
    {editor&&<PostEditor item={editor.mode==='new'?null:editor} collections={collections} onClose={()=>setEditor(null)} onSaved={load}/>}
    {collectionEditor&&<CollectionEditor item={collectionEditor.mode==='new'?null:collectionEditor} products={products} onClose={()=>setCollectionEditor(null)} onSaved={load}/>}
  </section>;
}
