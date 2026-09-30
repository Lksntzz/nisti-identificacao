import React, { useEffect, useMemo, useState } from 'react';

function Icon({ name, size = 18 }) {
  const common = {
    width:size, height:size, viewBox:'0 0 24 24', fill:'none',
    stroke:'currentColor', strokeWidth:1.9, strokeLinecap:'round', strokeLinejoin:'round',
    'aria-hidden':true
  };
  if (name === 'product') return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.4 7.7 7.6 4.2 7.6-4.2M12 12v9"/></svg>;
  if (name === 'collection') return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>;
  if (name === 'notice') return <svg {...common}><path d="M4 13V9l12-5v14L4 13Z"/><path d="M16 8h2.5A2.5 2.5 0 0 1 21 10.5v1A2.5 2.5 0 0 1 18.5 14H16M6 13l1.5 6h4L10 14"/></svg>;
  if (name === 'document') return <svg {...common}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></svg>;
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
  if (name === 'sliders') return <svg {...common}><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M8 15v4"/></svg>;
  if (name === 'more') return <svg {...common}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
  return <svg {...common}><path d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35L12 3Z"/></svg>;
}

function statusLabel(value) {
  return { draft:'Rascunho', published:'Publicado', archived:'Arquivado' }[value] || value;
}

function dateParts(value) {
  if (!value) return { date:'—', time:'' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date:'—', time:'' };
  return {
    date:date.toLocaleDateString('pt-BR'),
    time:date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
  };
}

function authorLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Admin';
  if (raw.startsWith('system:')) return 'Sistema';
  if (raw === 'admin') return 'Admin';
  return raw;
}

function initials(value) {
  return String(value || 'AD').split(/\s+/).map(part=>part[0]).filter(Boolean).join('').slice(0,2).toUpperCase() || 'AD';
}

function Status({ value }) {
  return <span className={'mural-admin-status '+value}><i aria-hidden="true"/>{statusLabel(value)}</span>;
}

export default function MuralPublicationsDashboard({ posts, collections, loading, onEdit, onAction, onPush }) {
  const [kind,setKind]=useState('');
  const [status,setStatus]=useState('');
  const [author,setAuthor]=useState('');
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState('recent');
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(10);
  const [openMenu,setOpenMenu]=useState(null);

  useEffect(()=>{ setPage(1); },[kind,status,author,search,sort,pageSize]);

  const counts=useMemo(()=>({
    all:posts.length,
    product:posts.filter(row=>row.kind==='product').length,
    collection:posts.filter(row=>row.kind==='collection').length,
    notice:posts.length?posts.filter(row=>row.kind==='notice').length:0
  }),[posts]);

  const authors=useMemo(
    ()=>[...new Set(posts.map(row=>authorLabel(row.created_by)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),
    [posts]
  );

  const filtered=useMemo(()=>{
    const needle=search.trim().toLocaleLowerCase('pt-BR');
    const rows=posts.filter(row=>{
      if(kind&&row.kind!==kind)return false;
      if(status&&row.status!==status)return false;
      if(author&&authorLabel(row.created_by)!==author)return false;
      if(!needle)return true;
      return [
        row.title,row.subtitle,row.product_sku,row.product_name,row.product_collection_name,
        row.collection_name,row.badge,row.created_by
      ].some(value=>String(value||'').toLocaleLowerCase('pt-BR').includes(needle));
    });
    return [...rows].sort((a,b)=>{
      if(sort==='title')return String(a.title||'').localeCompare(String(b.title||''),'pt-BR');
      const left=new Date(a.published_at||a.created_at||0).getTime()||0;
      const right=new Date(b.published_at||b.created_at||0).getTime()||0;
      return sort==='oldest'?left-right:right-left;
    });
  },[posts,kind,status,author,search,sort]);

  const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
  const safePage=Math.min(page,totalPages);
  const visible=filtered.slice((safePage-1)*pageSize,safePage*pageSize);
  const activeCollections=collections.filter(row=>row.status==='active').length;
  const publishedProducts=posts.filter(row=>row.kind==='product'&&row.status==='published').length;
  const publishedNotices=posts.filter(row=>row.kind==='notice'&&row.status==='published').length;
  const thisWeek=posts.filter(row=>{
    const time=new Date(row.created_at||row.published_at||0).getTime();
    return Number.isFinite(time)&&time>0&&Date.now()-time<=7*86400000;
  }).length;

  return <>
    <div className="mural-admin-summary-grid">
      <article><span className="metric-icon blue"><Icon name="document" size={25}/></span><div><strong>{counts.all}</strong><b>Publicações</b><small>{thisWeek?'+ '+thisWeek+' esta semana':'Sem novas esta semana'}</small></div></article>
      <article><span className="metric-icon indigo"><Icon name="product" size={25}/></span><div><strong>{counts.product}</strong><b>Produtos</b><small>{publishedProducts} publicados</small></div></article>
      <article><span className="metric-icon cyan"><Icon name="collection" size={25}/></span><div><strong>{activeCollections}</strong><b>Coleções ativas</b><small>{counts.collection} publicações de coleção</small></div></article>
      <article><span className="metric-icon pink"><Icon name="notice" size={25}/></span><div><strong>{publishedNotices}</strong><b>Avisos publicados</b><small>{counts.notice} avisos cadastrados</small></div></article>
    </div>

    <section className="mural-admin-publications-card">
      <div className="mural-admin-publication-tabs">
        {[
          ['', 'sparkles', 'Todas', counts.all],
          ['product','product','Produtos',counts.product],
          ['collection','collection','Coleções',counts.collection],
          ['notice','notice','Avisos',counts.notice]
        ].map(([value,icon,label,count])=>(
          <button type="button" key={label} className={kind===value?'active':''} onClick={()=>setKind(value)}>
            <Icon name={icon} size={16}/><span>{label}</span><b>{count}</b>
          </button>
        ))}
        <div className="mural-admin-searchbox"><Icon name="search" size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por título, coleção ou SKU..."/></div>
        <button type="button" className="mural-admin-filter-icon" aria-label="Filtros"><Icon name="sliders" size={18}/></button>
      </div>

      <div className="mural-admin-filterbar">
        <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos os status</option><option value="draft">Rascunhos</option><option value="published">Publicados</option><option value="archived">Arquivados</option></select>
        <select value={author} onChange={e=>setAuthor(e.target.value)}><option value="">Qualquer autor</option>{authors.map(name=><option key={name} value={name}>{name}</option>)}</select>
        <select value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Mais recentes primeiro</option><option value="oldest">Mais antigos primeiro</option><option value="title">Título A–Z</option></select>
      </div>

      <div className="mural-admin-modern-table-wrap">
        <table className="mural-admin-modern-table">
          <thead><tr><th>Publicação</th><th>Tipo</th><th>Selo</th><th>Status</th><th>Período</th><th>Autor</th><th>Ações</th></tr></thead>
          <tbody>
            {visible.map(row=>{
              const imageUrl=row.image_key
                ? '/api/admin/mural/posts/'+row.id+'/image?v='+encodeURIComponent(row.image_key)
                : row.product_image_url || row.collection_image_url || '';
              const period=dateParts(row.published_at);
              const expires=dateParts(row.expires_at);
              const author=authorLabel(row.created_by);
              const typeLabel=row.kind==='product'?'Produto':row.kind==='collection'?'Coleção':'Aviso';
              const meta=row.kind==='product'
                ? [row.product_sku,row.product_collection_name].filter(Boolean).join(' · ')
                : row.kind==='collection'
                  ? (row.collection_name||'Coleção do Mural')
                  : row.notice_level==='important'?'Aviso importante':'Comunicado aos operadores';
              return <tr key={row.id}>
                <td><div className="mural-admin-publication-cell">
                  <span className={'thumb '+row.kind}>{imageUrl?<img src={imageUrl} alt="" aria-hidden="true"/>:<Icon name={row.kind==='notice'?'notice':row.kind} size={28}/>}</span>
                  <span className="copy"><b>{row.title}</b><small>{row.subtitle||'Sem subtítulo'}</small>{meta&&<em>{meta}</em>}</span>
                </div></td>
                <td><span className={'mural-admin-kind '+row.kind}><Icon name={row.kind} size={15}/>{typeLabel}</span></td>
                <td><div className="mural-admin-badges">{Boolean(row.featured)&&<span className="featured">★ DESTAQUE</span>}{row.badge&&<span className="badge">{row.badge}</span>}{row.kind==='notice'&&row.notice_level==='important'&&<span className="important">IMPORTANTE</span>}{!row.badge&&!row.featured&&!(row.kind==='notice'&&row.notice_level==='important')&&<span className="muted">—</span>}</div></td>
                <td><Status value={row.status}/></td>
                <td><span className="mural-admin-period"><b>{period.date}</b>{period.time&&<small>{period.time}</small>}{row.expires_at?<em>até {expires.date}</em>:<em>Sem data de fim</em>}</span></td>
                <td><span className="mural-admin-author"><i>{initials(author)}</i><span><b>{author}</b><small>{row.updated_at?dateParts(row.updated_at).date:'—'}</small></span></span></td>
                <td className="mural-admin-actions-cell">
                  <button type="button" className="mural-admin-kebab" aria-label={'Ações de '+row.title} aria-expanded={openMenu===row.id} onClick={()=>setOpenMenu(current=>current===row.id?null:row.id)}><Icon name="more" size={19}/></button>
                  {openMenu===row.id&&<div className="mural-admin-action-menu">
                    <button onClick={()=>{setOpenMenu(null);onEdit(row)}}>Editar publicação</button>
                    <button onClick={()=>{setOpenMenu(null);onEdit(row)}}>Pré-visualizar</button>
                    <button onClick={()=>onAction(row.id,'duplicate')}>Duplicar</button>
                    {row.status!=='published'&&<button onClick={()=>onAction(row.id,'publish')}>Publicar</button>}
                   {row.status!=='archived'&&<button onClick={()=>onAction(row.id,'archive')}>Arquivar</button>}
                    {row.status==='published'&&((row.kind==='notice'&&row.notice_level==='important')||row.kind==='product')&&<button onClick={()=>onPush(row)}>Enviar notificação</button>}
                  </div>}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
        {!loading&&!filtered.length&&<div className="mural-admin-empty">Nenhuma publicação encontrada com esses filtros.</div>}
        {loading&&<div className="mural-admin-empty">Carregando publicações…</div>}
      </div>

      <footer className="mural-admin-table-footer">
        <span>Mostrando {filtered.length?((safePage-1)*pageSize)+1:0}–{Math.min(safePage*pageSize,filtered.length)} de {filtered.length} publicações</span>
        <div className="mural-admin-pagination">
          <button type="button" disabled={safePage<=1} onClick={()=>setPage(current=>Math.max(1,current-1))}>‹</button>
          {Array.from({length:Math.min(totalPages,5)},(_,index)=>{
            const base=totalPages<=5?1:Math.min(Math.max(1,safePage-2),totalPages-4);
            const value=base+index;
            return <button type="button" className={safePage===value?'active':''} key={value} onClick={()=>setPage(value)}>{value}</button>;
          })}
          <button type="button" disabled={safePage>=totalPages} onClick={()=>setPage(current=>Math.min(totalPages,current+1))}>›</button>
          <select value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}><option value="10">10 por página</option><option value="20">20 por página</option><option value="50">50 por página</option></select>
        </div>
      </footer>
    </section>
  </>;
}
