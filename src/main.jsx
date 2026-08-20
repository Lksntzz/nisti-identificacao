import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';

const LOGO = '/nisti-logo-transparent.webp';
const LOGO_FALLBACK = '/nisti-app-icon.svg';
const PAGE_SIZE = 12;
const WIREO_OPTIONS = [['P','Preto'],['B','Branco'],['R','Rose Gold']];
const ACCESSORY_OPTIONS = [['P','Preto'],['B','Branco'],['A','Azul'],['R','Rosa'],['V','Verde'],['L','Laranja']];
const TASSEL_OPTIONS = [['X','Sem tassel'], ...ACCESSORY_OPTIONS];
const ADMIN_TABS = [['geral','Geral'],['mockups','Mockups'],['importacao','Importação'],['diagnostico','Diagnóstico'],['administracao','Administração']];

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

function formatDashboardTime(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function compactText(value, max = 74) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(4) : '—';
}

function eventKindLabel(kind) {
  if (kind === 'success') return 'Reconhecido';
  if (kind === 'unmatched') return 'Sem correspondência';
  if (kind === 'system_error') return 'Erro técnico';
  return 'Evento';
}

function productImage(product) {
  if (!product?.image_url) return '';
  const version = String(product.image_key || '').split('/').pop();
  const join = product.image_url.includes('?') ? '&' : '?';
  return version ? `${product.image_url}${join}v=${encodeURIComponent(version)}` : product.image_url;
}

function Icon({ name, size = 20 }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    box: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/><path d="M2 19h21"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    sparkles: <><path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/><path d="m5 14 .6 1.4L7 16l-1.4.6L5 18l-.6-1.4L3 16l1.4-.6z"/></>,
    alert: <><path d="M10.3 4.2 2.8 17.1A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
    search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/></>,
    edit: <><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} {...common}>{paths[name] || null}</svg>;
}

function BrandHeader({ admin = false, tab, onTab }) {
  const [publicLogoFailed, setPublicLogoFailed] = useState(false);
  return <header className={`topbar ${admin ? 'admin-topbar' : ''}`}>
    <div className="brand-block">
      {admin ? <div className="admin-brand-lockup" aria-label="NISTI PRINT">
        <img src={`${LOGO_FALLBACK}?v=admin-brand-2`} alt="" />
        <span><strong>NISTI</strong><b>PRINT</b></span>
      </div> : <img className="brand-logo" src={publicLogoFailed ? LOGO_FALLBACK : LOGO} alt="NISTI PRINT" onError={() => setPublicLogoFailed(true)} />}
      <div className="top-title"><small>NISTI PRINT</small><h1>Identificação Visual</h1></div>
    </div>
    {admin && <nav className="header-tabs" aria-label="Administração">
      {ADMIN_TABS.map(([id,label]) => <button key={id} type="button" className={`tab ${tab===id?'active':''}`} onClick={()=>onTab(id)}>{label}</button>)}
    </nav>}
    {admin && <div className="admin-actions">
      <div className="admin-user"><span className="admin-avatar">N</span><span><strong>Administrador</strong><small>NISTI PRINT</small></span></div>
      <a href="/admin-logout"><Icon name="logout" size={18}/>Sair</a>
    </div>}
  </header>;
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
  return <div className="editor-content">
    <div className="editor-grid">
      <img className="editor-preview" src={preview || productImage(product)} alt={product.sku}/>
      <div className="editor-form">
        <label className="file-input">Nova imagem<input type="file" accept="image/*" onChange={event=>choose(event.target.files?.[0])}/></label>
        <div className="editor-fields">
          <label>Wire-O<select value={finish.wireo} onChange={e=>setFinish({...finish,wireo:e.target.value})}>{WIREO_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label>Tassel<select value={finish.tassel} onChange={e=>setFinish({...finish,tassel:e.target.value})}>{TASSEL_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label>Elástico<select value={finish.elastico} onChange={e=>setFinish({...finish,elastico:e.target.value})}>{ACCESSORY_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        <div className="editor-actions"><button className="small-primary" type="button" disabled={busy} onClick={save}>{busy?'Salvando…':'Salvar alterações'}</button><button className="secondary" type="button" onClick={onClose}>Cancelar</button></div>
        {message&&<p className="message">{message}</p>}
      </div>
    </div>
  </div>;
}

function pageItems(page, pages) {
  if (pages <= 7) return Array.from({length: pages}, (_,i)=>i+1);
  const values = new Set([1, pages, page-1, page, page+1].filter(value=>value>=1&&value<=pages));
  const sorted = [...values].sort((a,b)=>a-b);
  const result=[];
  sorted.forEach((value,index)=>{if(index&&value-sorted[index-1]>1)result.push('…');result.push(value)});
  return result;
}

function Catalog({ products, refresh, focused=false }) {
  const [search,setSearch]=useState(''); const [platform,setPlatform]=useState(''); const [view,setView]=useState('grid'); const [page,setPage]=useState(1); const [editing,setEditing]=useState(null);
  const platforms=useMemo(()=>[...new Set(products.map(p=>p.platform).filter(Boolean))].sort(),[products]);
  const filtered=useMemo(()=>{const q=search.trim().toLowerCase();return products.filter(p=>(!platform||p.platform===platform)&&(!q||[p.sku,p.nome,p.variacao,p.capa_code].some(v=>String(v||'').toLowerCase().includes(q))))},[products,search,platform]);
  useEffect(()=>setPage(1),[search,platform]);
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  useEffect(()=>{if(page>pages)setPage(pages)},[page,pages]);
  const slice=filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  const editingProduct=products.find(product=>product.id===editing)||null;
  const closeEditor=()=>setEditing(null);
  const saveEditor=async()=>{await refresh();setEditing(null)};
  return <section className="section-card catalog-section">
    <div className="section-head catalog-head"><div><h2>{focused?'Mockups':'Catálogo de produtos'}</h2><p>{focused?'Gerencie imagens e acabamentos dos produtos.':'Gerencie os produtos e seus mockups.'}</p></div><span className="catalog-count">{filtered.length} produtos</span></div>
    <div className="catalog-tools">
      <label className="search-field"><Icon name="search" size={19}/><input type="text" placeholder="Buscar por nome, SKU ou capa…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <select aria-label="Filtrar plataforma" value={platform} onChange={e=>setPlatform(e.target.value)}><option value="">Todas as plataformas</option>{platforms.map(item=><option key={item}>{item}</option>)}</select>
      <div className="view-buttons" aria-label="Modo de visualização"><button type="button" aria-label="Grade" className={view==='grid'?'active':''} onClick={()=>setView('grid')}><Icon name="grid" size={18}/></button><button type="button" aria-label="Lista" className={view==='list'?'active':''} onClick={()=>setView('list')}><Icon name="list" size={19}/></button></div>
    </div>
    <div className={`catalog ${view}`}>{slice.map(product=><article className={`product-card ${view}`} key={product.id}>
      <div className="product-media">
        {product.image_url?<img className="product-thumb" src={productImage(product)} alt={product.sku}/>:<div className="product-thumb product-placeholder"><Icon name="image" size={28}/></div>}
        <button type="button" className="more-button" aria-label={`Editar ${product.sku}`} onClick={()=>setEditing(product.id)}><Icon name="more" size={19}/></button>
      </div>
      <div className="product-copy"><small className="product-sku">{product.sku}</small><strong>{product.nome||product.variacao||product.capa_code}</strong><div className="product-tags">{product.capa_code&&<span>{product.capa_code}</span>}{product.platform&&<span>{product.platform}</span>}</div></div>
      <button className="edit-button" type="button" onClick={()=>setEditing(product.id)}><Icon name="edit" size={16}/>Editar mockup</button>
    </article>)}</div>
    {!slice.length&&<div className="empty">Nenhum produto encontrado.</div>}
    <div className="pagination"><button className="page-nav" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Anterior</button>{pageItems(page,pages).map((item,index)=>item==='…'?<span className="page-ellipsis" key={`ellipsis-${index}`}>…</span>:<button type="button" key={item} className={`page-number ${page===item?'active':''}`} onClick={()=>setPage(item)}>{item}</button>)}<button className="page-nav" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>Próxima</button></div>
    {editingProduct&&<div className="editor-backdrop" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&closeEditor()}>
      <div className="editor-modal" role="dialog" aria-modal="true" aria-label={`Editar mockup ${editingProduct.sku}`}>
        <div className="editor-modal-head"><div><small>{editingProduct.sku}</small><h3>Editar mockup</h3></div><button type="button" aria-label="Fechar" onClick={closeEditor}><Icon name="close" size={20}/></button></div>
        <ProductEditor product={editingProduct} onClose={closeEditor} onSaved={saveEditor}/>
      </div>
    </div>}
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

function DiagnosticField({ label, value }) {
  return <div className="diagnostic-field"><span>{label}</span><strong>{value ?? '—'}</strong></div>;
}

function RecognitionDiagnostics({ filter, onFilter }) {
  const [events,setEvents]=useState([]); const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [selected,setSelected]=useState(null);
  const buildPath=()=>{
    if(filter==='issues')return '/api/admin/recognition-events?scope=issues&limit=100';
    if(['success','unmatched','system_error'].includes(filter))return `/api/admin/recognition-events?kind=${encodeURIComponent(filter)}&limit=100`;
    return '/api/admin/recognition-events?scope=all&limit=100';
  };
  const load=async(silent=false)=>{if(!silent)setLoading(true);setError('');try{const data=await api(buildPath());setEvents(data.events||[])}catch(err){setError(err.message)}finally{if(!silent)setLoading(false)}};
  useEffect(()=>{setSelected(null);load();const timer=setInterval(()=>load(true),30000);return()=>clearInterval(timer)},[filter]);
  const filters=[['issues','Problemas'],['all','Todos'],['success','Reconhecidos'],['unmatched','Sem correspondência'],['system_error','Erros técnicos']];
  return <section className="section-card diagnostics-section">
    <div className="section-head diagnostics-head"><div><h2>Diagnóstico de reconhecimento</h2><p>Cada tentativa fica registrada com resultado, confiança, candidatos e tempos do pipeline.</p></div><button type="button" className="diagnostic-refresh" onClick={()=>load()}>Atualizar</button></div>
    <div className="diagnostic-filters">{filters.map(([id,label])=><button key={id} type="button" className={filter===id?'active':''} onClick={()=>onFilter(id)}>{label}</button>)}</div>
    {error&&<div className="diagnostic-error">{error}</div>}
    {loading?<div className="diagnostic-loading"><div className="spinner"/>Carregando eventos…</div>:<div className="diagnostic-list">
      {!events.length&&<div className="diagnostic-empty"><strong>Nenhum evento detalhado neste filtro.</strong><span>O histórico detalhado começa a ser gravado a partir desta versão do sistema.</span></div>}
      {events.map(event=><button type="button" className={`diagnostic-row diagnostic-${event.kind}`} key={event.id} onClick={()=>setSelected(event)}>
        <span className={`diagnostic-status status-${event.kind}`}>{eventKindLabel(event.kind)}</span>
        <span className="diagnostic-time">{formatDashboardTime(event.created_at)}</span>
        <span className="diagnostic-code"><strong>{event.sku||event.capa_code||event.retrieval_top1_code||'Sem SKU'}</strong><small>{event.error_message?compactText(event.error_message,90):(event.identified_by||event.verification_mode||'Reconhecimento concluído')}</small></span>
        <span className="diagnostic-score"><small>Confiança</small><strong>{event.confidence===null?'—':`${Math.round(event.confidence*100)}%`}</strong></span>
        <span className="diagnostic-duration"><small>Tempo</small><strong>{event.total_ms?`${(event.total_ms/1000).toFixed(1)}s`:'—'}</strong></span>
        <span className="diagnostic-open">Ver detalhes</span>
      </button>)}
    </div>}
    {selected&&<div className="editor-backdrop diagnostic-backdrop" role="presentation" onMouseDown={e=>e.target===e.currentTarget&&setSelected(null)}><div className="diagnostic-modal" role="dialog" aria-modal="true">
      <div className="editor-modal-head"><div><small>{formatDashboardTime(selected.created_at)}</small><h3>{eventKindLabel(selected.kind)}</h3></div><button type="button" aria-label="Fechar" onClick={()=>setSelected(null)}><Icon name="close" size={20}/></button></div>
      <div className="diagnostic-modal-body">
        {selected.image_url&&<div className="diagnostic-product-image"><img src={selected.image_url} alt={selected.sku||selected.capa_code||'Produto retornado'}/><span>Imagem do produto retornado</span></div>}
        {selected.error_message&&<div className="diagnostic-message"><strong>O que aconteceu</strong><p>{selected.error_message}</p></div>}
        <div className="diagnostic-grid">
          <DiagnosticField label="HTTP" value={selected.http_status}/>
          <DiagnosticField label="SKU retornado" value={selected.sku}/>
          <DiagnosticField label="Capa retornada/proposta" value={selected.capa_code}/>
          <DiagnosticField label="Método" value={selected.identified_by||selected.verification_mode}/>
          <DiagnosticField label="Confiança" value={selected.confidence===null?'—':`${(selected.confidence*100).toFixed(1)}%`}/>
          <DiagnosticField label="Score selecionado" value={formatScore(selected.retrieval_score)}/>
          <DiagnosticField label="Top 1 do embedding" value={`${selected.retrieval_top1_code||'—'} · ${formatScore(selected.retrieval_top1)}`}/>
          <DiagnosticField label="Top 2 do embedding" value={`${selected.retrieval_top2_code||'—'} · ${formatScore(selected.retrieval_top2)}`}/>
          <DiagnosticField label="Margem Top1/Top2" value={formatScore(selected.retrieval_margin)}/>
          <DiagnosticField label="Candidatas verificadas" value={selected.candidate_count}/>
          <DiagnosticField label="Aceito por" value={selected.accepted_by}/>
          <DiagnosticField label="Modelo" value={selected.model}/>
          <DiagnosticField label="Embedding + índice" value={selected.embedding_ms===null?'—':`${selected.embedding_ms} ms`}/>
          <DiagnosticField label="Gemini fallback" value={selected.gemini_ms===null?'—':`${selected.gemini_ms} ms`}/>
          <DiagnosticField label="Tempo total" value={selected.total_ms?`${selected.total_ms} ms`:'—'}/>
        </div>
        <p className="diagnostic-note">A foto enviada pelo operador não é armazenada neste log. O painel registra somente a telemetria do reconhecimento e, quando existe, a imagem do produto que o sistema retornou.</p>
      </div>
    </div></div>}
  </section>;
}

function Administration({ metrics, storage, indexInfo }) {
  const db=metrics?.database; const gemini=metrics?.gemini; const recognition=metrics?.recognition; const today=recognition?.today||{}; const r2=storage?.r2;
  const hasTechnicalErrors=Number(today.system_errors||0)>0;
  const healthValue=!recognition?'—':hasTechnicalErrors?'Atenção':Number(today.attempts||0)>0?'Operacional':'Sem testes';
  const healthText=!recognition
    ? 'Métricas de reconhecimento indisponíveis.'
    : hasTechnicalErrors
      ? `${today.system_errors} erro(s) técnico(s) hoje. ${compactText(recognition.latest_error_message,110)}`
      : `Nenhum erro técnico hoje. ${today.unmatched||0} imagem(ns) sem correspondência.`;
  return <section className="section-card"><div className="section-head"><div><h2>Administração do sistema</h2><p>Métricas reais dos serviços conectados.</p></div></div><div className="admin-metrics">
    <article className="metric-card"><h3>Cloudflare D1</h3><div className="metric-value">{db?formatBytes(db.used_bytes):'—'}</div><p>{db?.products||0} produtos · {db?.products_with_image||0} com imagem · {db?.cover_embeddings||0} referências indexadas.</p><div className="metric-detail">{db?.status==='online'?'Banco online':'Métrica indisponível'}{db?.served_by_region?` · região ${db.served_by_region}`:''}</div></article>
    <article className="metric-card"><h3>Cloudflare R2</h3><div className="metric-value">{r2?formatBytes(r2.used_bytes):'—'}</div><p>{r2?.object_count||0} arquivos armazenados.</p><div className="metric-detail">{r2?.status==='online'?'Bucket online':'Métrica indisponível'}</div></article>
    <article className="metric-card"><h3>IA · reconhecimentos</h3><div className="metric-value">{recognition?today.attempts||0:'—'}</div><p>{today.successes||0} reconhecidos · {today.unmatched||0} sem correspondência · {today.system_errors||0} erros técnicos hoje.</p><div className="metric-detail">{gemini?.embedding_model||'—'} · {today.embedding_requests||0} embeddings · {today.generation_requests||0} verificações generativas de fallback</div></article>
    <article className={`metric-card ${hasTechnicalErrors?'metric-alert':'metric-ok'}`}><h3>Saúde do reconhecimento</h3><div className="metric-value">{healthValue}</div><p>{healthText}</p><div className="metric-detail">{recognition?.latest_success_at?`Último sucesso: ${formatDashboardTime(recognition.latest_success_at)}`:'Nenhum sucesso registrado desde o início do monitoramento.'}</div></article>
  </div></section>;
}

function KpiCard({ tone, icon, label, value, meta, progress, online, onClick }) {
  const className=`kpi kpi-${tone}${onClick?' kpi-clickable':''}`;
  const content=<><div className="kpi-icon"><Icon name={icon} size={24}/></div><div className="kpi-copy"><span>{label}</span><strong className={online?'status-value':''}>{online&&<i/>}{value}</strong><small>{meta}</small>{typeof progress==='number'&&<div className="kpi-progress"><span style={{width:`${Math.max(0,Math.min(100,progress))}%`}}/></div>}</div></>;
  return onClick?<button type="button" className={className} onClick={onClick}>{content}</button>:<article className={className}>{content}</article>;
}

function AdminApp() {
  const [tab,setTab]=useState('geral'); const [products,setProducts]=useState([]); const [metrics,setMetrics]=useState(null); const [storage,setStorage]=useState(null); const [indexInfo,setIndexInfo]=useState(null); const [loading,setLoading]=useState(true); const [diagnosticFilter,setDiagnosticFilter]=useState('issues');
  const refresh=async()=>{const [p,i]=await Promise.all([api('/api/products'),api('/api/admin/cover-index')]);setProducts(p.products||[]);setIndexInfo(i)};
  const refreshMetrics=async()=>{const [m,s]=await Promise.all([api('/api/admin/system-metrics').catch(()=>null),api('/api/admin/storage-metrics').catch(()=>null)]);setMetrics(m);setStorage(s)};
  const refreshSystemMetrics=async()=>{const m=await api('/api/admin/system-metrics').catch(()=>null);if(m)setMetrics(m)};
  useEffect(()=>{Promise.all([refresh(),refreshMetrics()]).catch(error=>{if(/não autorizado/i.test(error.message))location.href='/admin-login'}).finally(()=>setLoading(false))},[]);
  useEffect(()=>{const timer=setInterval(refreshSystemMetrics,30000);return()=>clearInterval(timer)},[]);
  const withImage=products.filter(p=>p.image_key).length; const pending=products.length-withImage; const progress=products.length?Math.round(withImage/products.length*100):0;
  const refreshAll=async()=>{await refresh();await refreshMetrics()};
  const db=metrics?.database; const recognition=metrics?.recognition; const today=recognition?.today||{}; const systemErrors=Number(today.system_errors||0); const unmatched=Number(today.unmatched||0); const issues=systemErrors+unmatched;
  const databaseMeta=db?`${formatBytes(db.used_bytes)} · ${db.products||0} produtos · ${db.cover_embeddings||0} refs`:'Métricas indisponíveis';
  const recognitionMeta=recognition?`${today.successes||0} reconhecidos · ${unmatched} sem correspondência`:'Métricas indisponíveis';
  const errorMeta=!recognition
    ? 'Métricas indisponíveis'
    : issues>0
      ? `${unmatched} sem correspondência · ${systemErrors} erro(s) técnico(s)`
      : 'Nenhum problema registrado hoje';
  const changeTab=id=>{if(id==='diagnostico')setDiagnosticFilter('issues');setTab(id)};
  const openDiagnostics=()=>{setDiagnosticFilter('issues');setTab('diagnostico')};
  if(loading)return <main className="app admin-app"><BrandHeader admin tab={tab} onTab={changeTab}/><div className="loading"><div><div className="spinner"/>Carregando administração…</div></div></main>;
  return <main className="app admin-app"><BrandHeader admin tab={tab} onTab={changeTab}/>
    {tab==='geral'&&<><div className="kpis">
      <KpiCard tone="lilac" icon="box" label="Produtos cadastrados" value={products.length} meta="Total de SKUs"/>
      <KpiCard tone="pink" icon="image" label="Mockups com imagem" value={withImage} meta="Produtos com mockup"/>
      <KpiCard tone="yellow" icon="clock" label="Pendentes" value={pending} meta="Sem imagem"/>
      <KpiCard tone="blue" icon="chart" label="Progresso do catálogo" value={`${progress}%`} meta={`${withImage} de ${products.length}`} progress={progress}/>
      <KpiCard tone="green" icon="database" label="Banco de dados" value={!db?'—':db.status==='online'?'Online':'Erro'} meta={databaseMeta} online={db?.status==='online'}/>
      <KpiCard tone="amber" icon="sparkles" label="IA · reconhecimentos" value={recognition?today.attempts||0:'—'} meta={recognitionMeta} onClick={()=>{setDiagnosticFilter('all');setTab('diagnostico')}}/>
      <KpiCard tone={issues>0?'danger':'green'} icon="alert" label="Problemas no reconhecimento" value={recognition?issues:'—'} meta={errorMeta} online={Boolean(recognition)&&issues===0} onClick={openDiagnostics}/>
    </div><Catalog products={products} refresh={refreshAll}/></>}
    {tab==='mockups'&&<Catalog products={products} focused refresh={refreshAll}/>} 
    {tab==='importacao'&&<ImportPanel refresh={refreshAll}/>} 
    {tab==='diagnostico'&&<RecognitionDiagnostics filter={diagnosticFilter} onFilter={setDiagnosticFilter}/>} 
    {tab==='administracao'&&<Administration metrics={metrics} storage={storage} indexInfo={indexInfo}/>} 
  </main>;
}

createRoot(document.getElementById('root')).render(<AdminApp/>);
