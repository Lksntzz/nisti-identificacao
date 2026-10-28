import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';

const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const money=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const PLAT={SHOPEE:'Shopee',ML:'Mercado Livre'};
const MONTH_NAMES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const monthTitle=m=>{const s=String(m).slice(0,10);const n=MONTH_NAMES[Number(s.slice(5,7))-1];return n.charAt(0).toUpperCase()+n.slice(1)+' de '+s.slice(0,4);};
const compactMoney=v=>{const n=Number(v||0);return n>=1000?'R$ '+(n/1000).toLocaleString('pt-BR',{maximumFractionDigits:n>=100000?0:1})+' mil':money(n);};
const dmy=d=>{const s=String(d||'').slice(0,10);return s?s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4):'—';};
const norm=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();

// Ritmo: unidades por semana desde a criação e comparação dos últimos 28 dias com esse ritmo.
function pace(i){
  const perWeek=i.age_days>0?i.units/i.age_days*7:null;
  let trend=null;
  if(i.age_days>=56&&i.units>=10){const base=i.units/i.age_days*28;if(base>0){const d=(Number(i.u_last28||0)/base-1)*100;trend=d>=15?{cls:'up',txt:'▲ '+Math.round(d)+'%'}:d<=-15?{cls:'down',txt:'▼ '+Math.abs(Math.round(d))+'%'}:{cls:'flat',txt:'≈ estável'};}}
  return {perWeek,trend};
}

function EarlyBars({item}){
  const steps=[['7d',item.u7],['14d',item.u14],['28d',item.u28],['56d',item.u56]];
  const max=Math.max(1,...steps.map(x=>Number(x[1]||0)));
  return <div className="ndb-coh-bars" role="img" aria-label="Unidades vendidas nos primeiros 7, 14, 28 e 56 dias">
    {steps.map(([l,v])=><div key={l} className={'ndb-coh-bar'+(v==null?' is-na':'')} title={v==null?'Ainda não completou '+l+' de vida':num(v)+' un. nos primeiros '+l}>
      <b>{v==null?'—':num(v)}</b><i style={{height:v==null?2:Math.max(3,Number(v)/max*100)+'%'}}/><small>{l}</small></div>)}
  </div>;
}

function ProductRow({i}){
  const {perWeek,trend}=pace(i);
  const early=i.days_to_first_sale!=null&&i.days_to_first_sale<0;
  const first=i.days_to_first_sale==null?'sem vendas':early?'vendeu antes da data':'1ª venda em '+i.days_to_first_sale+' d';
  return <li className="ndb-coh-row">
    <div className="ndb-coh-prod">
      <strong title={i.title}>{i.title}</strong>
      <small><span className={'ndb-coh-pill p-'+String(i.platform).toLowerCase()}>{PLAT[i.platform]||i.platform}</span>{i.product_ref} · {num(i.listings)} {i.listings===1?'anúncio':'anúncios'}</small>
    </div>
    <div className="ndb-coh-when"><b>{dmy(i.created_on)}</b><small>{num(i.age_days)} dias · {first}</small></div>
    <EarlyBars item={i}/>
    <div className="ndb-coh-total"><b>{num(i.units)} un.</b><small>{money(i.revenue)}</small></div>
    <div className="ndb-coh-pace"><b>{perWeek==null?'—':String(Math.round(perWeek*10)/10).replace('.',',')+' /sem'}</b>
      <small title="Unidades nos últimos 28 dias, comparadas ao ritmo médio desde a criação">28d: {num(i.u_last28)} un.{trend&&<em className={'ndb-coh-trend '+trend.cls}>{trend.txt}</em>}</small></div>
  </li>;
}

// Aba "Cadastros por mês": produtos criados em cada mês e o desempenho desde o dia da criação.
export default function CohortsTab({platform='TODAS',query=''}){
  const [data,setData]=useState(null);
  const [error,setError]=useState(false);
  const [open,setOpen]=useState({});
  useEffect(()=>{
    const controller=new AbortController();
    setData(null);setError(false);
    fetchCommercialManager('/api/admin/commerce/sales-dashboard/cohorts?platform='+platform,{signal:controller.signal})
      .then(setData).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[platform]);
  const qn=norm(query);
  const months=useMemo(()=>(data?.months||[]).map(m=>({...m,items:(m.items||[]).filter(i=>!qn||norm(i.title).includes(qn)||norm(i.product_ref).includes(qn))})).filter(m=>m.items.length),[data,qn]);
  if(error)return <p className="ndb-empty">Consulta indisponível. Tente atualizar.</p>;
  if(!data)return <p className="ndb-empty">Carregando…</p>;
  if(!months.length)return <p className="ndb-empty">{qn?'Nenhum produto cadastrado encontrado nessa busca.':'Nenhum anúncio com data de criação para esta plataforma.'}</p>;
  const lastIdx=months.length-1;
  return <div className="ndb-coh">
    {months.map((m,idx)=>{
      const isOpen=open[m.month]??(idx===lastIdx);
      const units=m.items.reduce((a,i)=>a+Number(i.units||0),0),rev=m.items.reduce((a,i)=>a+Number(i.revenue||0),0);
      return <section key={m.month} className="ndb-coh-month">
        <button type="button" className="ndb-coh-head" aria-expanded={isOpen} onClick={()=>setOpen(o=>({...o,[m.month]:!isOpen}))}>
          <strong>{monthTitle(m.month)}</strong>
          <span className="ndb-coh-chip"><b>{num(m.items.length)}</b> produto{m.items.length===1?'':'s'} cadastrado{m.items.length===1?'':'s'}</span>
          <span className="ndb-coh-chip"><b>{num(units)}</b> un. vendidas</span>
          <span className="ndb-coh-chip"><b>{compactMoney(rev)}</b></span>
          <i aria-hidden="true">{isOpen?'▾':'▸'}</i>
        </button>
        {isOpen&&<>
          <div className="ndb-coh-cols" aria-hidden="true"><span>Produto</span><span>Criado em</span><span>Vendas nos primeiros dias</span><span>Total desde a criação</span><span>Ritmo</span></div>
          <ul className="ndb-coh-list">{m.items.map(i=><ProductRow key={i.platform+i.product_ref} i={i}/>)}</ul></>}
      </section>;})}
    <p className="ndb-note">Data de criação vinda da planilha “Análise de Anúncios” ({num((data.months||[]).reduce((a,m)=>a+(m.items||[]).length,0))} produtos). Vendas contadas até {dmy(data.last_day)}. No Mercado Livre, o produto soma todos os itens do mesmo catálogo (ML Antigo e ML Novo juntos). Compare pelos blocos de 7, 14, 28 e 56 dias, não pelo total, porque produtos mais antigos tiveram mais tempo para vender. A seta do ritmo compara os últimos 28 dias com a média desde a criação (só para produtos com 56+ dias e 10+ vendas).</p>
  </div>;
}
