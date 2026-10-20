import React,{useEffect,useState} from 'react';
import {commerceApi} from './commerce-admin-api.js';
import './commerce-shopee-ads-summary.css';
import {shopeeAdsRowsForPeriod,preferredShopeeAdsReport} from './commerce-shopee-ads-period.js';
const units=n=>n==null?'—':new Intl.NumberFormat('pt-BR').format(n);
const money=n=>n==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
const pct=n=>n==null?'—':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(n)+'%';
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';
export default function CommerceShopeeAdsSummary({listingId,periodStart,periodEnd,onlySelectedPeriod=true,onOnlySelectedPeriodChange=()=>{}}) {
  const [loading,setLoading]=useState(false),[items,setItems]=useState([]);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!listingId)return;
    const ctrl=new AbortController();setLoading(true);setError('');
    commerceApi('/api/admin/commerce/listings/manager/'+listingId+'/shopee-ads',
      {signal:ctrl.signal,cache:'no-store'})
      .then(x=>{if(!ctrl.signal.aborted)setItems(x?.items||[]);})
      .catch(e=>{if(!ctrl.signal.aborted)setError(e.message);})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[listingId]);
  // General report is canonical. Targeting is supporting evidence, NOT additional sales.
  const matchingRows=shopeeAdsRowsForPeriod(items,periodStart,periodEnd,onlySelectedPeriod);
  const preferred=preferredShopeeAdsReport(matchingRows);
  const importedPeriod=preferredShopeeAdsReport(items);
  return <div className="nim-ads-evidence nim-ads-evidence-tab" aria-label="Métricas de publicidade Shopee Ads">
    <header className="nim-ads-evidence-heading">
      <h4>Métricas e tráfego publicitário</h4>
      <p>Impressões, cliques e conversões de campanhas Shopee Ads. Tráfego pago não equivale a visitas orgânicas.</p>
    </header>
    <div className="nim-ads-evidence-body">
      <label className="nim-ads-evidence-filter">
        <input type="checkbox" checked={Boolean(onlySelectedPeriod)}
          onChange={event=>onOnlySelectedPeriodChange(event.target.checked)}/>
        Mostrar somente o período selecionado no filtro
      </label>
      {onlySelectedPeriod&&<p className="nim-ads-evidence-selected">
        Filtro de vendas: {date(periodStart)} a {date(periodEnd)}
      </p>}
      {loading?<p>Carregando publicidade…</p>:error?<p role="alert">{error}</p>:!preferred?
        <p>{onlySelectedPeriod&&importedPeriod
          ?'Não há relatório Shopee Ads exatamente para '+date(periodStart)+' a '+date(periodEnd)+
           '. O relatório disponível é acumulado de '+date(importedPeriod.start)+' a '+
           date(importedPeriod.end)+'. Importe um relatório Shopee Ads desse intervalo para ver métricas confiáveis, ou desmarque a opção para consultar o acumulado.'
          :onlySelectedPeriod
            ?'Nenhum relatório Shopee Ads disponível exatamente para o período do filtro. Importe o relatório correspondente para visualizar os números sem estimativas.'
            :'Não há relatório Shopee Ads associado a este anúncio.'}</p>:<>
        <div className="nim-ads-evidence-period">
          <strong>Período acumulado: {date(preferred.start)} a {date(preferred.end)}</strong>
          <small>{preferred.report_kind==='GENERAL'?'Relatório geral de publicidade':'Relatório de segmentação, sem dados gerais'}
            {' · '}{preferred.shop_name}</small>
        </div>
        <div className="nim-ads-evidence-kpis">
          {[['Impressões (tráfego pago)',units(preferred.impressions)],['Cliques (anúncios)',units(preferred.clicks)],
            ['CTR',pct(preferred.ctr_pct)],['Conversões Ads',units(preferred.conversions)],
            ['Taxa de conversão Ads',pct(preferred.conversion_pct)],['Itens atribuídos',units(preferred.items_sold)],
            ['Despesas',money(preferred.spend)],['GMV atribuído',money(preferred.gmv)],
            ['ROAS',preferred.roas==null?'—':String(preferred.roas)]]
            .map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}
        </div>
        <p className="nim-ads-evidence-note">Impressões, cliques e CTR medem somente anúncios pagos. {onlySelectedPeriod
          ?'Métricas do relatório com datas exatamente iguais às do filtro selecionado.'
          :'Dados acumulados do relatório original, independentes do período do filtro.'}
          Conversões e GMV atribuídos à publicidade não devem ser somados às vendas gerais do NISTI.</p>
        {items.some(x=>x.report_kind==='TARGETING')&&
          <p className="nim-ads-evidence-note">Relatório de segmentação também registrado. Ele pode sobrepor os mesmos resultados e não é adicionado aos totais.</p>}
      </>}
    </div>
  </div>;
}
