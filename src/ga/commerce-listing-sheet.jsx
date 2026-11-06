import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {maskMoney} from './commerce-privacy.js';
import {priceChanges,cancelRate,unitEconomics,funnelRows,overlapping,adsRoas} from './commerce-listing-sheet-logic.js';
import './commerce-listing-sheet.css';

// Ficha do anúncio (Shopee): vendas por semana, preço praticado, funil, o que sobra por unidade, cancelamento e Ads.
// Só mostra dados. Sem veredito automático e sem inventar valor: o que não existe aparece como "—".
const n0=v=>new Intl.NumberFormat('pt-BR').format(Math.round(Number(v)||0));
const n1=v=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}).format(Number(v)||0);
const brl=v=>maskMoney(v==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0));
const dm=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.slice(8,10)+'/'+s.slice(5,7):'—';
const dmy=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';
const pct=v=>v==null?'—':n1(v)+'%';

function WeeklyChart({weeks,changes}){
  const W=680,H=150,left=8,right=8,top=16,base=122;
  const step=(W-left-right)/Math.max(1,weeks.length);
  const bw=Math.max(6,step*0.68);
  const max=Math.max(1,...weeks.map(w=>Number(w.units)||0));
  const prices=weeks.filter(w=>w.has_extras&&w.price_paid_avg!=null).map(w=>Number(w.price_paid_avg));
  const pmin=prices.length?Math.min(...prices):0,pmax=prices.length?Math.max(...prices):1;
  const py=p=>base-8-(pmax===pmin?0.5:(p-pmin)/(pmax-pmin))*(base-top-24);
  const x=i=>left+i*step+step/2;
  const pts=weeks.map((w,i)=>w.has_extras&&w.price_paid_avg!=null?x(i)+','+py(Number(w.price_paid_avg)).toFixed(1):null).filter(Boolean);
  const idx=new Map(weeks.map((w,i)=>[w.week_start,i]));
  return <svg viewBox={'0 0 '+W+' '+H} width="100%" role="img" aria-label="Unidades vendidas por semana e preço pago médio" className="nim-sheet-chart">
    <title>Unidades vendidas por semana e preço pago médio</title>
    {weeks.map((w,i)=>{
      const h=Math.round((Number(w.units)||0)/max*(base-top-14));
      return <g key={w.week_start}>
        <rect x={x(i)-bw/2} y={base-h} width={bw} height={h} className={w.partial?'is-partial':'is-bar'}>
          <title>{'Semana de '+dm(w.week_start)+': '+n0(w.units)+' un.'+(w.partial?' (semana incompleta)':'')+(w.has_extras&&w.price_paid_avg!=null?' · preço pago '+brl(w.price_paid_avg):'')}</title>
        </rect>
        {(i===0||String(w.week_start).slice(5,7)!==String(weeks[i-1].week_start).slice(5,7))&&
          <text x={x(i)} y={base+14} textAnchor="middle" className="nim-sheet-tick">{dm(w.week_start)}</text>}
      </g>;
    })}
    {changes.map(c=>idx.has(c.week_start)&&<line key={c.week_start} x1={x(idx.get(c.week_start))} x2={x(idx.get(c.week_start))} y1={top-4} y2={base} className="nim-sheet-change"/>)}
    {pts.length>1&&<polyline points={pts.join(' ')} className="nim-sheet-price"/>}
  </svg>;
}

export default function CommerceListingSheet({listingId,source}){
  const [state,setState]=useState({loading:true,error:'',data:null});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(source!=='SHOPEE')return undefined;
    const controller=new AbortController();
    setState({loading:true,error:'',data:null});
    fetchCommercialManager('/api/admin/commerce/listings/manager/'+encodeURIComponent(listingId)+'/sheet?weeks=26',{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setState({loading:false,error:'',data});})
      .catch(e=>{if(!controller.signal.aborted)setState({loading:false,error:e?.message||'Não foi possível carregar a ficha.',data:null});});
    return()=>controller.abort();
  },[listingId,source,retry]);
  const data=state.data;
  if(source!=='SHOPEE')return <p className="nim-detail-hint">A ficha com histórico semanal está disponível só para anúncios da Shopee por enquanto.</p>;
  if(state.loading)return <p className="nim-detail-pending" role="status">Carregando a ficha do anúncio…</p>;
  if(state.error)return <div className="nim-sheet-error" role="alert">{state.error} <button type="button" onClick={()=>setRetry(n=>n+1)}>Tentar novamente</button></div>;
  if(!data)return <p className="nim-detail-pending">Ficha não encontrada.</p>;
  return <ListingSheetView data={data}/>;
}

// Parte só de desenho: recebe os dados prontos (fácil de testar sem rede).
export function ListingSheetView({data}){
  const weeks=Array.isArray(data?.weeks)?data.weeks:[];
  const changes=useMemo(()=>priceChanges(weeks),[weeks]);
  const econ=useMemo(()=>unitEconomics(weeks),[weeks]);
  const cancel=useMemo(()=>cancelRate(weeks),[weeks]);
  const funnel=useMemo(()=>funnelRows(data?.funnel),[data]);
  const lastExtras=[...weeks].reverse().find(w=>w.has_extras);
  const recent=[...weeks].slice(-8).reverse();
  const ads=Array.isArray(data.ads)?data.ads:[];
  const reasons=Array.isArray(data.cancel_reasons)?data.cancel_reasons:[];
  const ufs=Array.isArray(data.uf_units)?data.uf_units:[];
  const ufTotal=ufs.reduce((a,u)=>a+(Number(u.units)||0),0);
  return <div className="nim-sheet">
    <p className="nim-sheet-source">Vendas até {dmy(data.sales_through)} · dados de pedido (preço, cancelamento, frete) até a semana de {lastExtras?dm(lastExtras.week_start):'—'}. {data.skus} SKU{data.skus===1?'':'s'} neste anúncio.</p>

    <section aria-label="Vendas por semana">
      <div className="nim-sheet-head"><h4>Vendas por semana e preço praticado</h4>
        <span className="nim-sheet-legend"><i className="is-bar"/>unidades <i className="is-price"/>preço pago médio</span></div>
      <WeeklyChart weeks={weeks} changes={changes}/>
      <p className="nim-sheet-note">Barras cinza são semanas incompletas. O preço só aparece nas semanas com dados de pedido.
        {changes.length>0&&' Linhas tracejadas: mudança de preço de 3% ou mais ('+changes.map(c=>dm(c.week_start)+': '+brl(c.from)+' → '+brl(c.to)).join('; ')+').'}</p>
      <div className="nim-sheet-scroll"><table className="nim-sheet-table">
        <thead><tr><th>Semana</th><th>Unid.</th><th>Preço pago</th><th>Preço de tabela</th><th>Cancel.</th><th>Frete líq.</th><th>Taxas</th></tr></thead>
        <tbody>{recent.map(w=><tr key={w.week_start}>
          <td>{dm(w.week_start)}{w.partial?'*':''}</td><td>{n0(w.units)}</td>
          <td>{w.has_extras?brl(w.price_paid_avg):'—'}</td><td>{w.has_extras?brl(w.price_orig_avg):'—'}</td>
          <td>{w.has_extras&&w.cancelled_units!=null?n0(w.cancelled_units):'—'}</td>
          <td>{w.has_extras&&w.ship_est_avg!=null?brl(Number(w.ship_est_avg)-Number(w.ship_paid_avg||0)):'—'}</td>
          <td>{pct(w.fee_pct)}</td></tr>)}</tbody></table></div>
      <p className="nim-sheet-note">* semana incompleta. Frete líquido = frete estimado menos o que o cliente paga, por pedido.</p>
    </section>

    <section aria-label="Funil de visitas">
      <div className="nim-sheet-head"><h4>Funil por relatório de desempenho</h4></div>
      {funnel.length?<div className="nim-sheet-scroll"><table className="nim-sheet-table">
        <thead><tr><th>Período</th><th>Visitantes</th><th>Carrinho</th><th>Conversão</th><th>Pedidos</th><th>Impressões</th></tr></thead>
        <tbody>{funnel.map(f=><tr key={f.period_start+f.period_end}><td>{dm(f.period_start)} a {dm(f.period_end)}</td>
          <td>{n0(f.visitors)}</td><td>{pct(f.cartPct)}</td><td>{pct(f.convPct)}</td><td>{n0(f.orders)}</td><td>{n0(f.impressions)}</td></tr>)}</tbody></table></div>
        :<p className="nim-detail-hint">Este anúncio não aparece nos relatórios de desempenho importados.</p>}
      {funnel.some((a,i)=>funnel.slice(i+1).some(b=>overlapping(a,b)))&&<p className="nim-sheet-note">Algumas janelas se sobrepõem; compare só janelas que não se cruzam.</p>}
    </section>

    <div className="nim-sheet-two">
      <section aria-label="O que sobra por unidade">
        <div className="nim-sheet-head"><h4>O que sobra por unidade</h4></div>
        {econ?<table className="nim-sheet-table nim-sheet-econ"><tbody>
          <tr><td>Preço pago pelo cliente</td><td>{brl(econ.price)}</td></tr>
          <tr><td>Preço de tabela</td><td>{brl(econ.listPrice)}</td></tr>
          <tr><td>Taxas da Shopee ({pct(econ.feePct)})</td><td>{econ.fees==null?'—':'−'+brl(econ.fees)}</td></tr>
          <tr><td>Frete (estimado menos o que o cliente paga)</td><td>{econ.shipNet==null?'—':'−'+brl(econ.shipNet)}</td></tr>
          <tr><td>Custo do produto</td><td className="nim-sheet-muted">não informado</td></tr>
          <tr className="is-total"><td>Sobra antes do custo</td><td>{brl(econ.left)}</td></tr></tbody></table>
          :<p className="nim-detail-hint">Sem semanas completas com dados de pedido.</p>}
        {econ&&<p className="nim-sheet-note">Média das últimas {econ.weeks} semanas completas com dados de pedido. Estimativa: quem paga o restante do frete ainda não foi confirmado e o custo do produto não está no sistema, então isto não é lucro.{!econ.complete&&' Faltam taxas ou frete em parte das semanas, e a sobra fica maior do que a real.'}</p>}
      </section>
      <section aria-label="Cancelamentos">
        <div className="nim-sheet-head"><h4>Cancelamentos</h4></div>
        {cancel?<p className="nim-sheet-big">{pct(cancel.pct)}<small> das unidades nas últimas {cancel.weeks} semanas com dados</small></p>:<p className="nim-detail-hint">Sem dados de cancelamento.</p>}
        {reasons.length>0&&<ul className="nim-sheet-list">{reasons.map(r=><li key={r.reason}><span>{r.reason}</span><b>{n0(r.units)}</b></li>)}</ul>}
        <p className="nim-sheet-note">Motivos somados nas 26 semanas. Cancelados não entram nas vendas.</p>
      </section>
    </div>

    <div className="nim-sheet-two">
      <section aria-label="Shopee Ads">
        <div className="nim-sheet-head"><h4>Shopee Ads</h4></div>
        {ads.length?<table className="nim-sheet-table"><thead><tr><th>Período</th><th>Gasto</th><th>Vendas dos Ads</th><th>Retorno</th></tr></thead>
          <tbody>{ads.map(a=><tr key={a.period_start+a.period_end}><td>{dm(a.period_start)} a {dm(a.period_end)}</td><td>{brl(a.spend)}</td><td>{brl(a.gmv)}</td>
            <td>{adsRoas(a)==null?'—':n1(adsRoas(a))+' para 1'}</td></tr>)}</tbody></table>
          :<p className="nim-detail-hint">Sem relatório de Ads para este anúncio.</p>}
        {ads.length>0&&<p className="nim-sheet-note">Usa só o relatório geral, para não contar duas vezes.</p>}
      </section>
      <section aria-label="Estados">
        <div className="nim-sheet-head"><h4>Para onde vendeu</h4></div>
        {ufs.length?<ul className="nim-sheet-list">{ufs.map(u=><li key={u.uf}><span>{u.uf}</span><b>{ufTotal>0?n1((Number(u.units)||0)/ufTotal*100)+'%':'—'}</b></li>)}</ul>
          :<p className="nim-detail-hint">Sem dados de pedido.</p>}
        {ufs.length>0&&<p className="nim-sheet-note">Participação entre os 6 estados principais, nas semanas com dados de pedido.</p>}
      </section>
    </div>
  </div>;
}
