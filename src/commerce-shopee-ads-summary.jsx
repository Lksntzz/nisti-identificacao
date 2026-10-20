import React,{useEffect,useState} from 'react';
import {commerceApi} from './commerce-admin-api.js';
import './commerce-shopee-ads-summary.css';
const units=n=>n==null?'—':new Intl.NumberFormat('pt-BR').format(n);
const money=n=>n==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
const pct=n=>n==null?'—':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(n)+'%';
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';
export default function CommerceShopeeAdsSummary({listingId}) {
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false),[items,setItems]=useState([]);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!open||!listingId)return;
    const ctrl=new AbortController();setLoading(true);setError('');
    commerceApi('/api/admin/commerce/listings/manager/'+listingId+'/shopee-ads',
      {signal:ctrl.signal,cache:'no-store'})
      .then(x=>{if(!ctrl.signal.aborted)setItems(x?.items||[]);})
      .catch(e=>{if(!ctrl.signal.aborted)setError(e.message);})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[open,listingId]);
  // General report is canonical. Targeting is supporting evidence, NOT additional sales.
  const general=items.filter(x=>x.report_kind==='GENERAL');
  const preferred=(general.length?general:items)[0]||null;
  return <details className="nim-ads-evidence" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>Publicidade Shopee Ads <span>{open?'−':'+'}</span></summary>
    {open&&<div className="nim-ads-evidence-body">
      {loading?<p>Carregando publicidade…</p>:error?<p role="alert">{error}</p>:!preferred?
        <p>Não há relatório Shopee Ads associado a este ID de produto. Isso não significa anúncio sem publicidade.</p>:<>
        <div className="nim-ads-evidence-period">
          <strong>Período acumulado: {date(preferred.start)} a {date(preferred.end)}</strong>
          <small>{preferred.report_kind==='GENERAL'?'Relatório geral de publicidade':'Relatório de segmentação, sem dados gerais'}
            {' · '}{preferred.shop_name}</small>
        </div>
        <div className="nim-ads-evidence-kpis">
          {[['Impressões',units(preferred.impressions)],['Cliques',units(preferred.clicks)],
            ['CTR',pct(preferred.ctr_pct)],['Conversões Ads',units(preferred.conversions)],
            ['Taxa de conversão Ads',pct(preferred.conversion_pct)],['Itens atribuídos',units(preferred.items_sold)],
            ['Despesas',money(preferred.spend)],['GMV atribuído',money(preferred.gmv)],
            ['ROAS',preferred.roas==null?'—':String(preferred.roas)]]
            .map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}
        </div>
        <p className="nim-ads-evidence-note">Valores acumulados do período do arquivo; não representam os filtros de vendas de 7/30/60/90 dias.
          Conversões e GMV atribuídos à publicidade não devem ser somados às vendas gerais do NISTI.</p>
        {items.some(x=>x.report_kind==='TARGETING')&&
          <p className="nim-ads-evidence-note">Relatório de segmentação também registrado. Ele pode sobrepor os mesmos resultados e não é adicionado aos totais.</p>}
      </>}
    </div>}
  </details>;
}
