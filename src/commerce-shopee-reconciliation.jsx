import React,{useEffect,useState} from 'react';
import './commerce-shopee-reconciliation.css';

const BASE='/api/admin/commerce/listings/manager/shopee/reconciliation';
const PAGE_SIZE=15;
const fmt=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));

async function api(path,options){
  const response=await fetch(BASE+path,{
    cache:'no-store',credentials:'same-origin',...options,
    headers:{'content-type':'application/json',...(options?.headers||{})}
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error||'Falha na conciliação Shopee.');
  return data;
}
function Description({item}){
  if(item.status==='DUPLICATE_SKU')
    return <span className="nsr-status nsr-status-conflict">SKU repetido · sem atribuição segura</span>;
  if(item.status==='APPROVED')
    return <span className="nsr-status nsr-status-approved">
      {item.approved_by==='NISTI_AUTO_YEAR_26_27'?'Ano 26 → 27 · automático':'Vínculo confirmado manualmente'}
    </span>;
  if(item.suggested_variation_id)
    return <span className="nsr-status nsr-status-suggestion">Possível SKU antigo</span>;
  return <span className="nsr-status nsr-status-unmatched">Sem anúncio ativo correspondente</span>;
}
export default function ShopeeSkuReconciliation({onChanged,onClose}){
  const [state,setState]=useState('PENDING');
  const [searchDraft,setSearchDraft]=useState('');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(0);
  const [revision,setRevision]=useState(0);
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [active,setActive]=useState(null);
  const [variation,setVariation]=useState(null);
  const [targetText,setTargetText]=useState('');
  const [targetSearch,setTargetSearch]=useState('');
  const [targets,setTargets]=useState([]);
  const [targetsLoading,setTargetsLoading]=useState(false);
  const [evidence,setEvidence]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [saving,setSaving]=useState(false);
  const [confirmationError,setConfirmationError]=useState('');
  const [revoking,setRevoking]=useState(null);

  useEffect(()=>{
    const timer=setTimeout(()=>{setSearch(searchDraft.trim());setPage(0);},300);
    return ()=>clearTimeout(timer);
  },[searchDraft]);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError('');
    const qs=new URLSearchParams({state,limit:String(PAGE_SIZE),offset:String(page*PAGE_SIZE)});
    if(search)qs.set('search',search);
    api('?'+qs).then(v=>{if(!cancelled)setData(v);})
      .catch(e=>{if(!cancelled){setError(e.message);setData(null);}})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[state,search,page,revision]);

  useEffect(()=>{
    const timer=setTimeout(()=>setTargetSearch(targetText.trim()),280);
    return ()=>clearTimeout(timer);
  },[targetText]);
  useEffect(()=>{
    let cancelled=false;
    setTargets([]);
    if(!active||targetSearch.length<2)return ()=>{cancelled=true;};
    setTargetsLoading(true);
    api('/candidates?search='+encodeURIComponent(targetSearch))
      .then(v=>{if(!cancelled)setTargets(Array.isArray(v.items)?v.items:[]);})
      .catch(e=>{if(!cancelled)setConfirmationError(e.message);})
      .finally(()=>{if(!cancelled)setTargetsLoading(false);});
    return ()=>{cancelled=true;};
  },[active?.sku,targetSearch]);

  const clearReview=()=>{
    setActive(null);setVariation(null);setTargetText('');setTargetSearch('');
    setTargets([]);setEvidence('');setConfirmed(false);setConfirmationError('');setRevoking(null);
  };
  const review=item=>{
    clearReview();setActive(item);
    if(item.suggested_variation_id){
      setVariation({
        variation_id:item.suggested_variation_id,
        external_listing_id:item.suggested_listing_id,
        listing_title:item.suggested_listing_title,
        variation_name:item.suggested_variation_name,
        platform_sku:item.suggested_sku,
        sku_uses:1
      });
    }
  };
  const switchState=next=>{
    if(next===state)return;
    clearReview();setPage(0);setState(next);
  };
  const complete=()=>{
    clearReview();setRevision(v=>v+1);onChanged?.();
  };
  const confirm=async()=>{
    if(!active||!variation||!confirmed||evidence.trim().length<8||saving)return;
    setSaving(true);setConfirmationError('');
    try{
      await api('/approve',{
        method:'POST',
        body:JSON.stringify({
          sku:active.sku,variation_id:Number(variation.variation_id),
          evidence:evidence.trim(),confirmed:true
        })
      });
      complete();
    }catch(e){setConfirmationError(e.message)}
    finally{setSaving(false)}
  };
  const revoke=async()=>{
    if(!revoking||saving)return;
    setSaving(true);setConfirmationError('');
    try{
      await api('/revoke',{method:'POST',body:JSON.stringify({sku:revoking,confirmed:true})});
      complete();
    }catch(e){setConfirmationError(e.message)}
    finally{setSaving(false)}
  };
  const total=Number(data?.total||0);
  const count=Array.isArray(data?.items)?data.items.length:0;
  const maxPage=Math.max(1,Math.ceil(total/PAGE_SIZE));
  return <section className="nsr-panel" aria-label="Conciliação de SKUs das vendas Shopee">
    <div className="nsr-heading">
      <div><h3>Conciliação de vendas · Shopee</h3>
        <p>Relacione SKUs antigos apenas quando houver confirmação da mesma variação no anúncio.</p></div>
      <button type="button" className="nsr-close" onClick={onClose} aria-label="Fechar conciliação">×</button>
    </div>
    <div className="nsr-metrics">
      <div><small>SKUs aguardando revisão</small><strong>{data?fmt(data.pending_skus):'—'}</strong></div>
      <div><small>Unidades ainda sem vínculo</small><strong>{data?fmt(data.pending_units):'—'}</strong></div>
      <div><small>Possíveis códigos atualizados</small><strong>{data?fmt(data.candidate_skus):'—'}</strong></div>
      <div><small>Vínculos aplicados</small><strong>{data?fmt(data.approved_skus):'—'}</strong></div>
    </div>
    <p className="nsr-note">PB, PLAN, AGMT, CONFIN, VACMNO e VACMNA com ano 26 → 27, restante integral do SKU idêntico e uma única variação ativa são vinculados automaticamente. VACMNO e VACMNA sem ano usam correspondência direta pelo SKU completo. Diferenças no miolo, capa ou acessórios, códigos duplicados e outras famílias continuam para revisão. Nenhum SKU original, pedido ou produto do Scanner é modificado. Todos os vínculos podem ser revogados.</p>
    <div className="nsr-toolbar">
      <div role="group" aria-label="Situação dos SKUs" className="nsr-tabs">
        <button type="button" className={state==='PENDING'?'active':''}
          aria-pressed={state==='PENDING'} onClick={()=>switchState('PENDING')}>Pendentes</button>
        <button type="button" className={state==='APPROVED'?'active':''}
          aria-pressed={state==='APPROVED'} onClick={()=>switchState('APPROVED')}>Confirmados</button>
      </div>
      <input type="search" value={searchDraft} onChange={e=>setSearchDraft(e.target.value)}
        placeholder="Pesquisar SKU ou nome do produto" aria-label="Pesquisar SKUs da Shopee" maxLength={120}/>
    </div>
    {error&&<p className="nsr-error" role="alert">{error}</p>}
    <div className="nsr-list" aria-live="polite">
      {loading&&<p className="nsr-muted">Consultando SKUs…</p>}
      {!loading&&count===0&&!error&&<p className="nsr-muted">Nenhum SKU encontrado neste filtro.</p>}
      {!loading&&data?.items?.map(item=><div className="nsr-row" key={item.sku}>
        <div className="nsr-row-main">
          <div className="nsr-row-top"><strong>{item.sku}</strong><Description item={item}/></div>
          <p>{item.title||'Nome do produto não informado'}</p>
          <small>{fmt(item.months)} mês(es) · {fmt(item.units)} unidades · {brl(item.revenue)}</small>
          {item.status==='APPROVED'&&<small className="nsr-approved-target">
            Vinculado ao anúncio {item.approved_listing_id} · SKU {item.approved_sku}
          </small>}
          {item.suggested_variation_id&&<small className="nsr-recommendation">
            Sugestão: anúncio {item.suggested_listing_id} · {item.suggested_sku}
          </small>}
        </div>
        {item.status==='DUPLICATE_SKU'
          ?<span className="nsr-row-hint">Requer ID de variação na origem</span>
          :item.status==='APPROVED'
            ?<button type="button" className="nsr-link" onClick={()=>{
              clearReview();setActive(item);setRevoking(item.sku);
            }}>Revisar / revogar</button>
            :<button type="button" className="nsr-action" onClick={()=>review(item)}>Revisar vínculo</button>}
      </div>)}
    </div>
    <div className="nsr-pagination">
      <span>{loading?'Consultando…':fmt(total)+' SKUs · página '+(page+1)+' de '+maxPage}</span>
      <div><button type="button" disabled={loading||page===0} onClick={()=>{clearReview();setPage(p=>Math.max(0,p-1));}}>Anterior</button>
        <button type="button" disabled={loading||(page+1)*PAGE_SIZE>=total}
          onClick={()=>{clearReview();setPage(p=>p+1);}}>Próxima</button></div>
    </div>
    {active&&<div className="nsr-review" aria-label={'Revisar SKU '+active.sku}>
      <div className="nsr-review-title"><strong>{revoking?'Revogar vínculo':'Confirmar vínculo de SKU antigo'}</strong>
        <button type="button" onClick={clearReview} aria-label="Fechar revisão">×</button></div>
      <p><strong>SKU das vendas: {active.sku}</strong> · {active.title}</p>
      {revoking?
        <>
          <p className="nsr-note">O vínculo será desativado e as unidades voltarão para a fila de conciliação. Os pedidos originais permanecem inalterados.</p>
          <button type="button" disabled={saving} className="nsr-danger" onClick={revoke}>
            {saving?'Revogando…':'Confirmar revogação'}</button>
        </>:
        <>
          <label className="nsr-search-label">Pesquisar anúncio ativo ou SKU atual
            <input type="search" value={targetText} onChange={e=>{
              setTargetText(e.target.value);setVariation(null);setConfirmed(false);
            }}
              placeholder="ID, nome ou SKU da variação" maxLength={120}/>
          </label>
          {targetsLoading&&<small className="nsr-muted">Procurando variações…</small>}
          {targets.length>0&&<div className="nsr-candidates" role="list" aria-label="Variações disponíveis">
            {targets.map(c=><button key={c.variation_id} role="listitem" type="button"
              disabled={Number(c.sku_uses)!==1} onClick={()=>{setVariation(c);setConfirmed(false);}}
              className={String(variation?.variation_id)===String(c.variation_id)?'selected':''}>
              <span><strong>{c.listing_title}</strong><small>Anúncio {c.external_listing_id} · {c.variation_name||'Variação única'}</small></span>
              <span>{c.platform_sku||'SKU ausente'}{Number(c.sku_uses)!==1&&<small>· SKU repetido</small>}</span>
            </button>)}
          </div>}
          {variation&&<div className="nsr-picked">
            <small>Variação escolhida</small>
            <strong>{variation.listing_title}</strong>
            <span>Anúncio {variation.external_listing_id} · {variation.variation_name||'Variação única'} · SKU {variation.platform_sku}</span>
          </div>}
          <label className="nsr-search-label">Justificativa da confirmação
            <textarea value={evidence} onChange={e=>setEvidence(e.target.value)}
              placeholder="Ex.: conferi no anúncio que o SKU de 2026 foi atualizado para o mesmo produto em 2027"
              rows={2} maxLength={500}/>
          </label>
          <label className="nsr-confirm"><input type="checkbox" checked={confirmed}
            onChange={e=>setConfirmed(e.target.checked)}/>
            <span>Confirmei que este SKU das vendas e a variação escolhida representam o mesmo produto em todo o histórico importado.</span>
          </label>
          <button type="button" className="nsr-save" onClick={confirm}
            disabled={!variation||!confirmed||evidence.trim().length<8||saving}>
            {saving?'Salvando vínculo…':'Confirmar vínculo revisado'}</button>
        </>}
      {confirmationError&&<p className="nsr-error" role="alert">{confirmationError}</p>}
    </div>}
  </section>;
}
