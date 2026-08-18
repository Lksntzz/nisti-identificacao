import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';

const LOGO = '/nisti-logo-transparent.webp';
const PAGE_SIZE = 12;
const WIREO_OPTIONS = [['P','Preto'],['B','Branco'],['R','Rose Gold']];
const ACCESSORY_OPTIONS = [['P','Preto'],['B','Branco'],['A','Azul'],['R','Rosa'],['V','Verde'],['L','Laranja']];
const TASSEL_OPTIONS = [['X','Sem tassel'], ...ACCESSORY_OPTIONS];

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`);
  return data;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function productImage(product) {
  if (!product?.image_url) return '';
  const version = String(product.image_key || '').split('/').pop();
  const join = product.image_url.includes('?') ? '&' : '?';
  return version ? `${product.image_url}${join}v=${encodeURIComponent(version)}` : product.image_url;
}

async function compressPhoto(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  return blob ? new File([blob], 'capa.jpg', { type: 'image/jpeg' }) : file;
}

function BrandHeader({ admin = false }) {
  return <header className={`topbar ${admin ? 'admin-topbar' : ''}`}>
    <img className="brand-logo" src={LOGO} alt="NISTI PRINT" />
    <div className="top-title"><small>NISTI PRINT</small><h1>Identificação Visual</h1></div>
    {admin && <div className="admin-actions"><a href="/admin-logout">Sair</a></div>}
  </header>;
}

function Badge({ label, value }) {
  return <div className="badge"><span>{label}</span><strong>{value || '—'}</strong></div>;
}

function InstallApp() {
  const [prompt, setPrompt] = useState(null);
  const [help, setHelp] = useState(false);
  const [standalone, setStandalone] = useState(() => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const before = event => { event.preventDefault(); setPrompt(event); };
    const installed = () => setStandalone(true);
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', installed);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    return () => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', installed); };
  }, []);

  if (standalone) return null;
  const install = async () => {
    if (prompt) {
      await prompt.prompt();
      await prompt.userChoice.catch(() => null);
      setPrompt(null);
      return;
    }
    if (ios) setHelp(true);
    else alert('Abra o menu do navegador e escolha “Instalar app” ou “Adicionar à tela inicial”.');
  };

  return <>
    <button className="install-button" type="button" onClick={install}>↓ Instalar app</button>
    {help && <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && setHelp(false)}><div className="modal"><h3>Instalar no iPhone</h3><p>No Safari:</p><ol><li>Toque em Compartilhar.</li><li>Escolha Adicionar à Tela de Início.</li><li>Confirme em Adicionar.</li></ol><button type="button" onClick={() => setHelp(false)}>Entendi</button></div></div>}
  </>;
}

function ProductResult({ product, performance }) {
  return <div className="result">
    <p className="eyebrow">PRODUTO IDENTIFICADO PELA CAPA</p>
    <h3>{product.sku}</h3>
    {product.image_url && <img className="result-image" src={product.image_url} alt={`Mockup ${product.sku}`} />}
    <div className="badges">
      <Badge label="Capa" value={product.capa_code}/>
      <Badge label="Wire-O" value={product.wireo}/>
      <Badge label="Tassel" value={product.tassel}/>
      <Badge label="Elástico" value={product.elastico}/>
    </div>
    {product.platform && <p className="platform"><strong>Plataforma:</strong> {product.platform}</p>}
    {performance?.total_ms && <small className="perf">Identificado em {(performance.total_ms / 1000).toFixed(1)} s</small>}
  </div>;
}

function ProductChoices({ capaCode, products, onSelect, performance }) {
  return <div className="result">
    <p className="eyebrow">CAPA IDENTIFICADA</p>
    <h3 className="choice-title">{capaCode} · escolha o SKU</h3>
    <div className="choices">{products.map(product => <article className="choice-card" key={product.id}>
      {product.image_url ? <img src={product.image_url} alt={product.sku}/> : <div/>}
      <div><h4>{product.sku}</h4><p>{product.nome || product.variacao || product.capa_code}</p><p>Miolo: {product.miolo_code} · Acabamento: {product.acabamento_code}</p></div>
      <button type="button" onClick={() => onSelect(product)}>Selecionar este SKU</button>
    </article>)}</div>
    {performance?.total_ms && <small className="perf">Capa reconhecida em {(performance.total_ms / 1000).toFixed(1)} s</small>}
  </div>;
}

function GeneralApp() {
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [choices, setChoices] = useState(null);
  const [performance, setPerformance] = useState(null);
  const runId = useRef(0);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const identifyFile = async file => {
    if (!file || busy) return;
    const id = ++runId.current;
    setBusy(true); setError(''); setResult(null); setChoices(null); setPerformance(null);
    try {
      const optimized = await compressPhoto(file);
      const form = new FormData(); form.append('image', optimized);
      const data = await api('/api/identify', { method: 'POST', body: form });
      if (id !== runId.current) return;
      setPerformance(data.performance || null);
      if (data.needs_selection) setChoices({ capaCode: data.capa_code, products: data.products || [] });
      else setResult(data.product || null);
    } catch (err) {
      if (id === runId.current) setError(err.message);
    } finally {
      if (id === runId.current) setBusy(false);
    }
  };

  const choose = file => {
    if (!file) return;
    setPhoto(file); setError(''); setResult(null); setChoices(null); setPerformance(null);
    setPreview(current => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(file); });
    setTimeout(() => identifyFile(file), 160);
  };

  return <main className="app general">
    <BrandHeader />
    <section className="panel">
      <p className="eyebrow">PAINEL GERAL</p>
      <h2>Identificação de produto</h2>
      <p className="lead">Fotografe a capa do produto de frente. O sistema localiza a referência visual e retorna o SKU correspondente.</p>
      <label className="camera">
        <span className="camera-label">CAPA DO PRODUTO</span>
        {preview ? <><img className="photo-preview" src={preview} alt="Foto da capa"/><span className="photo-ready">Foto pronta</span></> : <div className="camera-empty"><span className="camera-icon">◎</span><strong>Fotografar ou enviar capa</strong><span>Use uma imagem frontal, nítida e com boa iluminação.</span></div>}
        <input type="file" accept="image/*" capture="environment" onChange={event => choose(event.target.files?.[0])}/>
      </label>
      <button className="primary" disabled={!photo || busy} onClick={() => identifyFile(photo)}>{busy ? 'Analisando capa…' : 'Identificar produto'}</button>
      {error && <div className="status error"><h3>Produto não identificado</h3><p>{error}</p></div>}
      {choices && <ProductChoices capaCode={choices.capaCode} products={choices.products} performance={performance} onSelect={product => { setResult(product); setChoices(null); }}/>} 
      {result && <ProductResult product={result} performance={performance}/>} 
    </section>
    <InstallApp />
  </main>;
}

function parseCsv(text) {
  const rows=[]; let row=[]; let cell=''; let quoted=false;
  const source=String(text||'').replace(/^\uFEFF/,'');
  for(let i=0;i<source.length;i++){
    const char=source[i],next=source[i+1];
    if(char==='"'){if(quoted&&next==='"'){cell+='"';i++}else quoted=!quoted;continue}
    if(char===','&&!quoted){row.push(cell);cell='';continue}
    if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&next==='\n')i++;row.push(cell);if(row.some(value=>String(value).trim()))rows.push(row);row=[];cell='';continue}
    cell+=char;
  }
  row.push(cell); if(row.some(value=>String(value).trim()))rows.push(row); return rows;
}

function catalogRowsFromCsv(text) {
  return parseCsv(text).map(row => ({
    nome:String(row[2]||row[9]||'').trim(), variacao:String(row[3]||row[13]||'').trim(),
    platform:String(row[4]||row[11]||'').trim(), sku:String(row[5]||row[14]||'').trim(), link:String(row[6]||row[12]||'').trim()
  })).filter(row => row.sku && row.sku.toUpperCase() !== 'SKU');
}

function ProductEditor({ product, onSaved, onClose }) {
  const [file,setFile]=useState(null); const [preview,setPreview]=useState(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  const [finish,setFinish]=useState({wireo:product.wireo_code||'B',tassel:product.tassel_code||'X',elastico:product.elastico_code||'B'});
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
  const choose=fileValue=>{if(!fileValue)return;setFile(fileValue);setPreview(current=>{if(current)URL.revokeObjectURL(current);return URL.createObjectURL(fileValue)})};
  const save=async()=>{
    setBusy(true);setMessage('');
    try{
      const finishChanged=finish.wireo!==product.wireo_code||finish.tassel!==product.tassel_code||finish.elastico!==product.elastico_code;
      if(finishChanged) await api(`/api/products/${product.id}/finish`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({wireo_code:finish.wireo,tassel_code:finish.tassel,elastico_code:finish.elastico})});
      if(file){const form=new FormData();form.append('image',file);await api(`/api/products/${product.id}/image`,{method:'POST',body:form})}
      if(!finishChanged&&!file) throw new Error('Nenhuma alteração para salvar.');
      setMessage('Alterações salvas.'); await onSaved();
    }catch(err){setMessage(err.message)}finally{setBusy(false)}
  };
  return <div className="editor">
    <div className="editor-grid">
      <img className="editor-preview" src={preview || productImage(product)} alt={product.sku}/>
      <div>
        <label className="file-input">Nova imagem<input type="file" accept="image/*" onChange={event=>choose(event.target.files?.[0])}/></label>
        <div className="editor-fields">
          <label>Wire-O<select value={finish.wireo} onChange={e=>setFinish({...finish,wireo:e.target.value})}>{WIREO_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label>Tassel<select value={finish.tassel} onChange={e=>setFinish({...finish,tassel:e.target.value})}>{TASSEL_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label>Elástico<select value={finish.elastico} onChange={e=>setFinish({...finish,elastico:e.target.value})}>{ACCESSORY_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        <div className="editor-actions"><button className="small-primary" type="button" disabled={busy} onClick={save}>{busy?'Salvando…':'Salvar alterações'}</button><button className="secondary" type="button" onClick={onClose}>Fechar</button></div>
        {message&&<p className="message">{message}</p>}
      </div>
    </div>
  </div>;
}

function Catalog({ products, refresh, focused=false }) {
  const [search,setSearch]=useState(''); const [platform,setPlatform]=useState(''); const [view,setView]=useState('grid'); const [page,setPage]=useState(1); const [editing,setEditing]=useState(null);
  const platforms=useMemo(()=>[...new Set(products.map(p=>p.platform).filter(Boolean))].sort(),[products]);
  const filtered=useMemo(()=>{const q=search.trim().toLowerCase();return products.filter(p=>(!platform||p.platform===platform)&&(!q||[p.sku,p.nome,p.variacao,p.capa_code].some(v=>String(v||'').toLowerCase().includes(q))))},[products,search,platform]);
  useEffect(()=>setPage(1),[search,platform]);
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)); const slice=filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  return <section className="section-card">
    <div className="section-head"><div><h2>{focused?'Mockups':'Catálogo de produtos'}</h2><p>{filtered.length} produto(s)</p></div></div>
    <div className="catalog-tools"><input type="text" placeholder="Buscar por nome, SKU ou capa…" value={search} onChange={e=>setSearch(e.target.value)}/><select value={platform} onChange={e=>setPlatform(e.target.value)}><option value="">Todas as plataformas</option>{platforms.map(item=><option key={item}>{item}</option>)}</select><div className="view-buttons"><button className={view==='grid'?'active':''} onClick={()=>setView('grid')}>▦</button><button className={view==='list'?'active':''} onClick={()=>setView('list')}>☷</button></div></div>
    <div className="platform-chips"><button className={`chip ${!platform?'active':''}`} onClick={()=>setPlatform('')}>Todos</button>{platforms.map(item=><button key={item} className={`chip ${platform===item?'active':''}`} onClick={()=>setPlatform(item)}>{item}</button>)}</div>
    <div className={`catalog ${view}`}>{slice.map(product=><article className={`product-card ${view}`} key={product.id}>
      <div className="product-main">{product.image_url?<img className="product-thumb" src={productImage(product)} alt={product.sku}/>:<div className="product-thumb"/>}<div className="product-copy"><strong>{product.sku}</strong><span>{product.nome||product.variacao||product.capa_code}</span><small>{product.platform||'Sem plataforma'} · capa {product.capa_code}</small></div><button className="edit-button" onClick={()=>setEditing(editing===product.id?null:product.id)}>{editing===product.id?'Fechar':'Editar mockup'}</button></div>
      {editing===product.id&&<ProductEditor product={product} onClose={()=>setEditing(null)} onSaved={async()=>{await refresh();setEditing(null)}}/>}
    </article>)}</div>
    {!slice.length&&<div className="empty">Nenhum produto encontrado.</div>}
    <div className="pagination"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>{page} / {pages}</span><button disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>Próxima</button></div>
  </section>;
}

function ImportPanel({ refresh }) {
  const [bulkBusy,setBulkBusy]=useState(false); const [bulkMessage,setBulkMessage]=useState(''); const [manualBusy,setManualBusy]=useState(false); const [manualMessage,setManualMessage]=useState(''); const [image,setImage]=useState(null);
  const [form,setForm]=useState({sku:'',nome:'',variacao:'',platform:'',link:''});
  const importCsv=async file=>{if(!file)return;setBulkBusy(true);setBulkMessage('');try{const rows=catalogRowsFromCsv(await file.text());if(!rows.length)throw new Error('Nenhum SKU encontrado no CSV.');let created=0,updated=0,errors=0;for(let i=0;i<rows.length;i+=50){const data=await api('/api/admin/bulk-products',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rows:rows.slice(i,i+50)})});created+=data.created||0;updated+=data.updated||0;errors+=(data.errors||[]).length}setBulkMessage(`Importação concluída: ${created} novos, ${updated} atualizados${errors?`, ${errors} erro(s)`:''}.`);await refresh()}catch(err){setBulkMessage(err.message)}finally{setBulkBusy(false)}};
  const submit=async event=>{event.preventDefault();setManualBusy(true);setManualMessage('');try{const created=await api('/api/products',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(form)});if(image){const fd=new FormData();fd.append('image',image);await api(`/api/products/${created.id}/image`,{method:'POST',body:fd})}setForm({sku:'',nome:'',variacao:'',platform:'',link:''});setImage(null);setManualMessage('Produto cadastrado.');await refresh()}catch(err){setManualMessage(err.message)}finally{setManualBusy(false)}};
  return <>
    <section className="section-card"><div className="section-head"><div><h2>Importação CSV</h2><p>Atualiza ou cadastra produtos em lote.</p></div></div><label className="file-input">Arquivo CSV<input type="file" accept=".csv,text/csv" disabled={bulkBusy} onChange={e=>importCsv(e.target.files?.[0])}/></label>{bulkMessage&&<p className="message">{bulkMessage}</p>}</section>
    <section className="section-card"><div className="section-head"><div><h2>Cadastro manual</h2><p>Use para inclusões pontuais.</p></div></div><form className="form" onSubmit={submit}><div className="grid2"><label>SKU<input type="text" required value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})} placeholder="MIOLO_CAPA_BBB"/></label><label>Nome<input type="text" value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})}/></label></div><div className="grid2"><label>Variação<input type="text" value={form.variacao} onChange={e=>setForm({...form,variacao:e.target.value})}/></label><label>Plataforma<input type="text" value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}/></label></div><label>Link<input type="url" value={form.link} onChange={e=>setForm({...form,link:e.target.value})}/></label><label className="file-input">Mockup opcional<input type="file" accept="image/*" onChange={e=>setImage(e.target.files?.[0]||null)}/></label><div className="form-actions"><button disabled={manualBusy}>{manualBusy?'Salvando…':'Cadastrar produto'}</button></div>{manualMessage&&<p className="message">{manualMessage}</p>}</form></section>
  </>;
}

function Administration({ metrics, storage, indexInfo }) {
  const db=metrics?.database; const gemini=metrics?.gemini; const r2=storage?.r2;
  return <section className="section-card"><div className="section-head"><div><h2>Administração do sistema</h2><p>Métricas reais dos serviços conectados.</p></div></div><div className="admin-metrics">
    <article className="metric-card"><h3>Cloudflare D1</h3><div className="metric-value">{db?formatBytes(db.used_bytes):'—'}</div><p>{db?.products||0} produtos · {db?.cover_embeddings||0} referências indexadas.</p></article>
    <article className="metric-card"><h3>Cloudflare R2</h3><div className="metric-value">{r2?formatBytes(r2.used_bytes):'—'}</div><p>{r2?.object_count||0} arquivos armazenados.</p></article>
    <article className="metric-card"><h3>Gemini</h3><div className="metric-value">{gemini?.configured?'Ativo':'Inativo'}</div><p>{gemini?.model||'—'} · {gemini?.embedding_model||'—'} · Top-K {indexInfo?.top_k||8}</p></article>
  </div></section>;
}

function AdminApp() {
  const [tab,setTab]=useState('geral'); const [products,setProducts]=useState([]); const [metrics,setMetrics]=useState(null); const [storage,setStorage]=useState(null); const [indexInfo,setIndexInfo]=useState(null); const [loading,setLoading]=useState(true);
  const refresh=async()=>{const [p,i]=await Promise.all([api('/api/products'),api('/api/admin/cover-index')]);setProducts(p.products||[]);setIndexInfo(i)};
  const refreshMetrics=async()=>{const [m,s]=await Promise.all([api('/api/admin/system-metrics').catch(()=>null),api('/api/admin/storage-metrics').catch(()=>null)]);setMetrics(m);setStorage(s)};
  useEffect(()=>{Promise.all([refresh(),refreshMetrics()]).catch(error=>{if(/não autorizado/i.test(error.message))location.href='/admin-login'}).finally(()=>setLoading(false))},[]);
  const withImage=products.filter(p=>p.image_key).length; const pending=products.length-withImage; const progress=products.length?Math.round(withImage/products.length*100):0;
  if(loading)return <main className="app"><BrandHeader admin/><div className="loading"><div><div className="spinner"/>Carregando administração…</div></div></main>;
  return <main className="app"><BrandHeader admin/><nav className="tabs">{[['geral','Geral'],['mockups','Mockups'],['importacao','Importação'],['administracao','Administração']].map(([id,label])=><button key={id} className={`tab ${tab===id?'active':''}`} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {tab==='geral'&&<><div className="kpis"><div className="kpi"><span>Produtos cadastrados</span><strong>{products.length}</strong><small>Total de SKUs</small></div><div className="kpi"><span>Mockups com imagem</span><strong>{withImage}</strong><small>Produtos com mockup</small></div><div className="kpi"><span>Pendentes</span><strong>{pending}</strong><small>Sem imagem</small></div><div className="kpi"><span>Progresso do catálogo</span><strong>{progress}%</strong><small>{withImage} de {products.length}</small></div><div className="kpi"><span>Banco de dados</span><strong>{metrics?.database?.status==='online'?'Online':'—'}</strong><small>{indexInfo?.indexed_covers||0} referências</small></div><div className="kpi"><span>Uso Gemini</span><strong>{metrics?.gemini?.configured?'Ativo':'—'}</strong><small>{metrics?.gemini?.embedding_model||'gemini-embedding-2'}</small></div></div><Catalog products={products} refresh={async()=>{await refresh();await refreshMetrics()}}/></>}
    {tab==='mockups'&&<Catalog products={products} focused refresh={async()=>{await refresh();await refreshMetrics()}}/>}
    {tab==='importacao'&&<ImportPanel refresh={async()=>{await refresh();await refreshMetrics()}}/>}
    {tab==='administracao'&&<Administration metrics={metrics} storage={storage} indexInfo={indexInfo}/>} 
  </main>;
}

function App(){return location.pathname==='/admin'?<AdminApp/>:<GeneralApp/>}

createRoot(document.getElementById('root')).render(<App/>);
