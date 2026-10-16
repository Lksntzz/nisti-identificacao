import React,{useEffect,useState} from 'react';
import {commerceApi} from './commerce-admin-api.js';
import ProductCutoutImage from './product-cutout-image.jsx';
import './commerce-scanner-pending.css';

const number=value=>new Intl.NumberFormat('pt-BR').format(Number(value||0));
const PAGE_SIZE=15;

export default function CommerceScannerPending({onCreateScanner}) {
  const [input,setInput]=useState('');
  const [search,setSearch]=useState('');
  const [offset,setOffset]=useState(0);
  const [request,setRequest]=useState(0);
  const [data,setData]=useState({items:[],total:0,limit:PAGE_SIZE,offset:0});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [confirmItem,setConfirmItem]=useState(null);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError('');
    const params=new URLSearchParams({limit:String(PAGE_SIZE),offset:String(offset)});
    if(search)params.set('search',search);
    commerceApi('/api/admin/commerce/scanner-pending?'+params)
      .then(result=>{if(!cancelled)setData(result&&typeof result==='object'?result:{items:[],total:0});})
      .catch(err=>{if(!cancelled){setData({items:[],total:0});setError(err.message||'Falha ao consultar anúncios pendentes.');}})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[offset,search,request]);

  const items=Array.isArray(data?.items)?data.items:[];
  const total=Number(data?.total||0);
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const page=Math.floor(offset/PAGE_SIZE)+1;
  function applySearch(event){
    event.preventDefault();
    setOffset(0);
    setSearch(input.trim());
  }
  async function confirmLink(){
    if(!confirmItem?.listing_id || !confirmItem?.scanner_product_id || saving)return;
    setSaving(true);setError('');setNotice('');
    try{
      const result=await commerceApi('/api/admin/commerce/scanner-pending/link',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({
          listing_id:confirmItem.listing_id,
          scanner_product_id:confirmItem.scanner_product_id,
          sku:confirmItem.sku
        })
      });
      setNotice('Vínculo confirmado: '+(result?.sku||confirmItem.sku)+'. O anúncio foi associado ao produto existente no Scanner, sem alterar o cadastro.');
      setConfirmItem(null);
      setRequest(v=>v+1);
    }catch(err){setError(err.message||'Não foi possível confirmar o vínculo.');}
    finally{setSaving(false);}
  }

  return <section className="commerce-scanner-pending">
    <div className="commerce-scanner-pending-header">
      <div>
        <h3>Anúncios ativos sem vínculo com o Scanner</h3>
        <p>Importados para o Catálogo Comercial, mas ainda não confirmados com um produto do NISTI ID.</p>
      </div>
      <span className="commerce-scanner-pending-count">{loading?'…':number(total)} pendências</span>
    </div>
    <p className="commerce-scanner-pending-guide">
      Vínculos são feitos por SKU exato confirmado. Se o SKU for diferente, revise a identidade antes de associar.
      Cadastrar no Scanner abre o formulário existente e <strong>não cria o produto automaticamente</strong>.
    </p>
    <form className="commerce-scanner-pending-search" onSubmit={applySearch}>
      <input type="search" value={input} onChange={e=>setInput(e.target.value)}
        placeholder="Buscar por anúncio, nome ou SKU" aria-label="Buscar anúncios pendentes"/>
      <button type="submit">Buscar</button>
      {search&&<button type="button" className="clear" onClick={()=>{setInput('');setSearch('');setOffset(0);}}>Limpar</button>}
    </form>
    {error&&<div role="alert" className="commerce-scanner-pending-alert error">{error}</div>}
    {notice&&<div role="status" className="commerce-scanner-pending-alert success">{notice}</div>}
    {loading&&<div className="commerce-scanner-pending-empty">Carregando anúncios pendentes…</div>}
    {!loading&&!error&&items.length===0&&<div className="commerce-scanner-pending-empty">
      {search?'Nenhum anúncio pendente corresponde à busca.':'Todos os anúncios encontrados estão vinculados ao Scanner.'}
    </div>}
    {!loading&&items.length>0&&<div className="commerce-scanner-pending-grid">
      {items.map(item=>{
        const oneMatch=Number(item.scanner_matches)===1&&Number(item.scanner_product_id)>0;
        const canLink=oneMatch&&Boolean(item.sku);
        const key=[item.listing_id,item.sku_norm,item.variation_id||''].join(':');
        return <article className="commerce-scanner-pending-item" key={key}>
          <div className="commerce-scanner-pending-image">
            <ProductCutoutImage src={item.image_url} alt={item.title||'Produto'}
              fallback={<span>Sem foto</span>}/>
          </div>
          <div className="commerce-scanner-pending-details">
            <strong>{item.title||'Produto sem nome'}</strong>
            <code>{item.sku||'SKU não informado'}</code>
            <div className="commerce-scanner-pending-meta">
              {item.url?<a href={item.url} target="_blank" rel="noopener noreferrer">{item.external_listing_id||'Abrir anúncio'} ↗</a>
                :<span>{item.external_listing_id||'Anúncio sem ID'}</span>}
              <span>{item.marketplace||'Plataforma'}{item.account?' · '+item.account:''}</span>
              {item.variation_id&&<span>Variação #{item.variation_id}</span>}
            </div>
            <div className="commerce-scanner-pending-status">
              {canLink
                ?<span className="matched">SKU correspondente no Scanner · produto #{item.scanner_product_id}</span>
                :Number(item.scanner_matches)>1
                  ?<span className="review">Mais de um produto com SKU equivalente; revisão obrigatória</span>
                  :<span className="review">{item.sku?'Ainda sem correspondência exata no Scanner':'Sem SKU: corrija a planilha antes de vincular'}</span>}
            </div>
            <div className="commerce-scanner-pending-actions">
              <button type="button" disabled={!canLink||saving}
                onClick={()=>{setError('');setConfirmItem(item);}}>Vincular existente</button>
              <button type="button" className="secondary" disabled={!onCreateScanner||saving}
                onClick={()=>onCreateScanner?.(item)}>Cadastrar no Scanner</button>
            </div>
          </div>
        </article>;
      })}
    </div>}
    {total>PAGE_SIZE&&<div className="commerce-scanner-pending-pagination">
      <span>Página {page} de {pages}</span>
      <button type="button" disabled={loading||offset===0}
        onClick={()=>setOffset(v=>Math.max(0,v-PAGE_SIZE))}>Anterior</button>
      <button type="button" disabled={loading||offset+PAGE_SIZE>=total}
        onClick={()=>setOffset(v=>v+PAGE_SIZE)}>Próxima</button>
    </div>}
    {confirmItem&&<div className="commerce-scanner-pending-backdrop" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="scanner-link-title" className="commerce-scanner-pending-dialog">
        <h4 id="scanner-link-title">Confirmar vínculo com o Scanner</h4>
        <p>O anúncio <strong>{confirmItem.external_listing_id}</strong> será relacionado ao produto Scanner <strong>#{confirmItem.scanner_product_id}</strong>, com SKU <code>{confirmItem.sku}</code>.</p>
        <p>Confirme somente se o produto físico, a capa e os acessórios forem exatamente os mesmos. O registro do Scanner não será alterado.</p>
        <div>
          <button type="button" className="secondary" disabled={saving} onClick={()=>setConfirmItem(null)}>Cancelar</button>
          <button type="button" disabled={saving} onClick={confirmLink}>{saving?'Vinculando…':'Confirmar vínculo'}</button>
        </div>
      </div>
    </div>}
  </section>;
}
