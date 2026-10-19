import React,{useEffect,useState} from 'react';

const BASE='/api/admin/commerce/listings/manager/shopee/unlinked-sales';
const PAGE_SIZE=20;
const number=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';

function statusLabel(status){
  if(status==='SKU_DUPLICADO')return 'SKU presente em múltiplas variações';
  if(status==='VINCULO_NAO_CONFIRMADO')return 'Sem vínculo exclusivo confirmado';
  return 'Sem anúncio ativo correspondente';
}

export default function ShopeeUnlinkedSales({days,month,importedThrough,revision,salesRevision,onChanged,onClose}){
  const [draft,setDraft]=useState('');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(0);
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [review,setReview]=useState(null);
  const [evidence,setEvidence]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [saving,setSaving]=useState(false);
  const [reviewError,setReviewError]=useState('');
  const [localRevision,setLocalRevision]=useState(0);
  const closeReview=()=>{
    setReview(null);setEvidence('');setConfirmed(false);setReviewError('');
  };
  const approve=async()=>{
    if(!review||saving||!confirmed||evidence.trim().length<8)return;
    setSaving(true);setReviewError('');
    try{
      const response=await fetch(
        '/api/admin/commerce/listings/manager/shopee/reconciliation/approve',{
          method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({sku:review.sku,
            variation_id:Number(review.possible_variation_id),
            evidence:evidence.trim(),confirmed:true})
        });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body?.error||'Não foi possível confirmar o vínculo.');
      closeReview();
      setLocalRevision(v=>v+1);
      onChanged?.();
    }catch(err){setReviewError(err.message);}
    finally{setSaving(false);}
  };
  useEffect(()=>{
    const timer=setTimeout(()=>{setSearch(draft.trim());setPage(0);},300);
    return ()=>clearTimeout(timer);
  },[draft]);
  useEffect(()=>{setPage(0);closeReview();},[days,month]);
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({days:String(days),limit:String(PAGE_SIZE),
      offset:String(page*PAGE_SIZE)});
    if(days===0&&month)params.set('month',month);
    if(search)params.set('search',search);
    setLoading(true);setError('');setData(null);
    fetch(BASE+'?'+params,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(async r=>{
        const body=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(body.error||'Não foi possível consultar as vendas sem vínculo.');
        return body;
      })
      .then(body=>{if(!controller.signal.aborted)setData(body);})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[days,month,page,search,revision,salesRevision,localRevision]);

  const total=Number(data?.total||0);
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const items=Array.isArray(data?.items)?data.items:[];
  return <section id="nim-unlinked-sales" className="nim-unlinked-panel"
    aria-label="Vendas Shopee sem anúncio identificado">
    <header className="nim-unlinked-head">
      <div><h3>Vendas sem anúncio identificado · Shopee</h3>
        <p>Vendas reais pelo SKU registrado na importação, independentemente do cadastro atual.</p>
      </div>
      <button type="button" className="nim-soft-button" onClick={onClose}
        aria-label="Fechar vendas sem vínculo">Fechar</button>
    </header>
    <p className="nim-unlinked-note">Estes registros não estão atribuídos a um anúncio ativo com segurança.
      Não representam todos os anúncios sem vendas vinculadas. O SKU original não é alterado.
      Em janelas diárias, o SKU exibido é recuperado do relatório mensal quando disponível.</p>
    <div className="nim-unlinked-summary" aria-live="polite">
      <span><strong>{data?number(total):'—'}</strong> SKUs com vendas sem vínculo</span>
      <span><strong>{data?number(data.units):'—'}</strong> unidades</span>
      <span><strong>{data?money(data.revenue):'—'}</strong> faturamento de produtos</span>
      {data&&<span>{date(data.period_start)} a {date(days===0&&importedThrough?importedThrough:data.period_end)}</span>}
    </div>
    <input className="nim-unlinked-search" type="search" value={draft}
      onChange={e=>setDraft(e.target.value)}
      placeholder="Pesquisar SKU ou produto vendido" maxLength={120}
      aria-label="Pesquisar vendas pelo SKU original"/>
    {error&&<p className="nim-unlinked-error" role="alert">{error}</p>}
    <div className="nim-unlinked-scroll">
      <table className="nim-unlinked-table">
        <thead><tr><th>SKU da venda</th><th>Produto / variação</th>
          <th className="nim-unlinked-number">Unidades</th>
          <th className="nim-unlinked-number">Faturamento</th><th>Situação</th></tr></thead>
        <tbody>
          {loading&&<tr><td colSpan={5}>Consultando vendas sem vínculo…</td></tr>}
          {!loading&&!error&&items.length===0&&<tr><td colSpan={5}>Nenhuma venda sem vínculo encontrada neste período.</td></tr>}
          {!loading&&items.map(item=><tr key={item.sku_norm||item.sku}>
            <td><strong>{item.sku||'SKU não informado'}</strong>
              {!item.original_available&&<small>Somente SKU normalizado disponível</small>}</td>
            <td><strong>{item.title||'Produto não informado'}</strong>
              {item.variation&&<small>{item.variation}</small>}</td>
            <td className="nim-unlinked-number">{number(item.units)}</td>
            <td className="nim-unlinked-number">{money(item.revenue)}</td>
            <td>{statusLabel(item.status)}
              {item.possible_external_listing_id&&<>
                <small className="nim-unlinked-match">Possível anúncio ativo: {item.possible_external_listing_id}</small>
                <small>{item.possible_listing_title}</small>
                <small>SKU atual: {item.possible_sku}</small>
                <button className="nim-unlinked-review-button" type="button"
                  onClick={()=>{setReview(item);setEvidence('');setConfirmed(false);setReviewError('');}}>
                  Revisar associação
                </button>
              </>}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {review&&<div className="nim-unlinked-review" aria-label="Revisar vínculo com anúncio ativo">
      <div className="nim-unlinked-head"><strong>Confirmar correspondência do SKU antigo</strong>
        <button type="button" onClick={closeReview} disabled={saving}>Fechar</button></div>
      <p>SKU da venda: <strong>{review.sku}</strong></p>
      <p>Anúncio ativo encontrado: <strong>{review.possible_external_listing_id}</strong> · {review.possible_listing_title}</p>
      <p>SKU do anúncio: <strong>{review.possible_sku}</strong></p>
      <p className="nim-unlinked-note">A referência do modelo é semelhante, mas o ano e o sufixo do SKU mudaram.
        Confira capa, elástico, material e produto antes de associar todo o histórico deste SKU.</p>
      <label>Justificativa da correspondência
        <textarea value={evidence} onChange={e=>setEvidence(e.target.value)}
          rows={2} maxLength={500} placeholder="Descreva como confirmou que é o mesmo produto"/></label>
      <label className="nim-unlinked-check"><input type="checkbox" checked={confirmed}
        onChange={e=>setConfirmed(e.target.checked)}/>
        Confirmo que a venda antiga e a variação atual são o mesmo produto.</label>
      {reviewError&&<p role="alert" className="nim-unlinked-error">{reviewError}</p>}
      <button type="button" className="nim-primary-button" onClick={approve}
        disabled={!confirmed||evidence.trim().length<8||saving}>
        {saving?'Confirmando…':'Confirmar vínculo auditável'}
      </button>
    </div>}
    <div className="nim-unlinked-actions">
      <small>{loading?'Consultando…':number(total)+' SKUs · página '+(page+1)+' de '+pages}</small>
      <div><button type="button" disabled={loading||page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Anterior</button>
        <button type="button" disabled={loading||(page+1)*PAGE_SIZE>=total} onClick={()=>setPage(p=>p+1)}>Próxima</button></div>
    </div>
  </section>;
}
