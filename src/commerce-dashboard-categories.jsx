import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {pickSummaryYear,summarizeCategories} from './commerce-dashboard-categories-logic.js';
import './commerce-dashboard-categories.css';

// Resumo de Categorias no Dashboard: top 5 + quem mais cresceu / mais caiu.
// Período fixo da tela Categorias (ano até hoje × mesmo período do ano anterior), independente do filtro de dias do Dashboard.
const fmt=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const num=n=>Number(n)||0;
const signed=n=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n));
const pct=(cur,base)=>num(base)>0?(num(cur)-num(base))/num(base)*100:null;
const PLAT_LABEL={TODAS:'todas as plataformas',SHOPEE:'Shopee',ML_ANTIGO:'Mercado Livre antigo',ML_NOVO:'Mercado Livre novo'};

export default function CategoriesSummary({platform,onOpen}) {
  const [state,setState]=useState({loading:true,error:'',data:null,year:null});
  useEffect(()=>{
    const controller=new AbortController();
    setState({loading:true,error:'',data:null,year:null});
    (async()=>{
      const cov=await fetchCommercialManager('/api/admin/commerce/sales-compare/annual-coverage',{signal:controller.signal});
      const year=pickSummaryYear(cov?.coverage,platform);
      if(!year)throw new Error('Sem histórico do ano anterior para comparar.');
      const data=await fetchCommercialManager('/api/admin/commerce/sales-compare/categories?platform='+encodeURIComponent(platform)+'&year='+year+'&mode=ytd',{signal:controller.signal});
      if(!controller.signal.aborted)setState({loading:false,error:'',data,year});
    })().catch(e=>{if(!controller.signal.aborted)setState({loading:false,error:e?.message||'Resumo indisponível.',data:null,year:null});});
    return()=>controller.abort();
  },[platform]);
  const {loading,error,data,year}=state;
  const s=data?summarizeCategories(data.categories):null;
  const total=data?.total||{cur:0,base:0};
  return <div className="ndbc">
    <p className="ndb-note">Ano até hoje × mesmo período de {year?year-1:'ano anterior'} · {PLAT_LABEL[platform]||platform}. Não segue o filtro de dias do Dashboard.</p>
    {loading&&<p className="ndb-empty">Carregando…</p>}
    {!loading&&error&&<p className="ndb-empty" role="status">{error}</p>}
    {s&&!s.top.length&&<p className="ndb-empty">Sem vendas por categoria neste recorte.</p>}
    {s&&s.top.length>0&&<>
      <ol className="ndbc-list">{s.top.map((c,i)=>{const p=pct(c.cur,c.base);return <li key={c.name}>
        <span className="ndbc-rank">{i+1}º</span>
        <span className="ndbc-name" title={c.name}>{c.name}</span>
        <span className="ndbc-bars" aria-hidden="true"><i className="is-base" style={{width:(c.base>0?Math.max(3,c.base/s.max*100):0)+'%'}}/><i className="is-cur" style={{width:(c.cur>0?Math.max(3,c.cur/s.max*100):0)+'%'}}/></span>
        <span className="ndbc-units">{fmt(c.cur)}</span>
        <span className={'ndbc-tag '+(p==null?'is-new':p>0?'is-up':p<0?'is-down':'')}>{p==null?'novo':(p>0?'+':p<0?'−':'')+Math.abs(Math.round(p*10)/10).toLocaleString('pt-BR')+'%'}</span>
      </li>;})}</ol>
      <p className="ndbc-foot">
        <span>Total: <b>{fmt(total.cur)}</b> un. (antes: {fmt(total.base)})</span>
        {s.rise&&<span>Mais cresceu: <b>{s.rise.name}</b> <em className="is-up">{signed(s.rise.cur-s.rise.base)}</em></span>}
        {s.fall&&<span>Mais caiu: <b>{s.fall.name}</b> <em className="is-down">{signed(s.fall.cur-s.fall.base)}</em></span>}
      </p>
    </>}
    {onOpen&&<button type="button" className="ndbc-open" onClick={onOpen}>Abrir Categorias ›</button>}
  </div>;
}
