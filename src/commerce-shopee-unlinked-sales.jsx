import React,{useEffect,useState} from 'react';
const BASE='/api/admin/commerce/listings/manager/shopee/unlinked-sales';
const PAGE_SIZE=20;
const number=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));
const monthLabel=p=>/^\d{4}-\d{2}$/.test(String(p||''))?p.slice(5,7)+'/'+p.slice(0,4):p;
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';

export default function ShopeeUnlinkedSales({days,month,importedThrough,search='',revision,salesRevision}){
  const [page,setPage]=useState(0);
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{setPage(0);},[days,month,search]);
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({
      days:String(days),limit:String(PAGE_SIZE),offset:String(page*PAGE_SIZE)
    });
    if(days===0&&month)params.set('month',month);
    if(search)params.set('search',search);
    setLoading(true);setError('');setData(null);
    fetch(BASE+'?'+params,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const body=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(body.error||'Falha ao consultar as vendas importadas.');
        return body;
      })
      .then(body=>{if(!controller.signal.aborted)setData(body);})
      .catch(err=>{if(!controller.signal.aborted)setError(err.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[days,month,page,search,revision,salesRevision]);
  const rows=Array.isArray(data?.items)?data.items:[];
  const total=Number(data?.total||0);
  if(!loading&&!error&&total===0)return null;
  return <section id="nim-unlinked-sales" className="nim-list-panel nim-sales-without-ad"
    aria-label="Vendas importadas pelo SKU da planilha">
    <header className="nim-list-header">
      <div><h3>Vendas importadas pelo SKU</h3>
        <small>Produtos vendidos sem ID exclusivo de anúncio no catálogo atual · histórico automático, sem conciliar SKU</small>
      </div>
      {data&&<span className="nim-unlinked-summary">
        <strong>{number(data.units)} un.</strong><strong>{money(data.revenue)}</strong>
      </span>}
    </header>
    {data&&<p className="nim-model-sales-period">
      {date(data.period_start)} a {date(days===0&&importedThrough?importedThrough:data.period_end)}
      {' · '}{number(total)} SKU(s) com vendas registradas neste filtro
    </p>}
    {error&&<p className="nim-unlinked-error" role="alert">{error}</p>}
    {loading&&<p className="nim-model-sales-loading">Consultando vendas importadas…</p>}
    {!loading&&rows.length>0&&<div className="nim-model-sales-grid">
      {rows.map(item=>{
        const history=Array.isArray(item.history_months)?item.history_months:[];
        const totalHistory=history.reduce((sum,m)=>sum+Number(m.units||0),0);
        const totalRevenue=history.reduce((sum,m)=>sum+Number(m.revenue||0),0);
        return <article className="nim-model-sale-card" key={item.sku_norm||item.sku}>
          <div className="nim-model-sale-title">
            <strong>{item.title||'Produto da Shopee'}</strong>
            <span>{item.sku||item.sku_norm||'SKU não informado'}
              {item.variation?' · '+item.variation:''}</span>
          </div>
          <div className="nim-model-sale-metrics">
            <div><small>Vendas no período</small><strong>{number(item.units)} unidades</strong></div>
            <div><small>Faturamento no período</small><strong>{money(item.revenue)}</strong></div>
          </div>
          {history.length>0&&<details className="nim-model-sale-history">
            <summary>Histórico mensal · {number(totalHistory)} un. · {money(totalRevenue)}</summary>
            <div className="nim-model-sale-months">
              {history.map(m=><div key={m.period}>
                <span>{monthLabel(m.period)}</span>
                <strong>{number(m.units)} un. · {money(m.revenue)}</strong>
              </div>)}
            </div>
            <p>Histórico do SKU ou modelo registrado nas planilhas, mesmo após atualização
              do código. Não é uma confirmação do ID do anúncio que originou cada pedido.</p>
          </details>}
        </article>;
      })}
    </div>}
    {total>PAGE_SIZE&&<footer className="nim-list-footer">
      <span>Página {page+1} de {Math.ceil(total/PAGE_SIZE)}</span>
      <div>
        <button type="button" disabled={loading||page===0}
          onClick={()=>setPage(p=>Math.max(0,p-1))}>Anterior</button>
        <button type="button" disabled={loading||(page+1)*PAGE_SIZE>=total}
          onClick={()=>setPage(p=>p+1)}>Próxima</button>
      </div>
    </footer>}
  </section>;
}
