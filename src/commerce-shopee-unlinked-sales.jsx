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

export default function ShopeeUnlinkedSales({days,month,revision,salesRevision,onClose}){
  const [draft,setDraft]=useState('');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(0);
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    const timer=setTimeout(()=>{setSearch(draft.trim());setPage(0);},300);
    return ()=>clearTimeout(timer);
  },[draft]);
  useEffect(()=>{setPage(0);},[days,month]);
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
  },[days,month,page,search,revision,salesRevision]);

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
      {data&&<span>{date(data.period_start)} a {date(data.period_end)}</span>}
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
            <td>{statusLabel(item.status)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="nim-unlinked-actions">
      <small>{loading?'Consultando…':number(total)+' SKUs · página '+(page+1)+' de '+pages}</small>
      <div><button type="button" disabled={loading||page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Anterior</button>
        <button type="button" disabled={loading||(page+1)*PAGE_SIZE>=total} onClick={()=>setPage(p=>p+1)}>Próxima</button></div>
    </div>
  </section>;
}
