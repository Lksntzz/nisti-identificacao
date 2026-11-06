import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {deltaPct,monthLabel,bestMonth} from './commerce-sales-breakdown-helpers.js';
import { maskMoney } from './commerce-privacy.js';

const num=v=>Number(v||0).toLocaleString('pt-BR');
const moneyRaw=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const money=(...a)=>maskMoney(moneyRaw(...a));
const dm=v=>String(v||'').slice(0,10).split('-').reverse().slice(0,2).join('/');
const WEEKDAY=['dom','seg','ter','qua','qui','sex','sáb'];
const weekday=v=>WEEKDAY[new Date(String(v).slice(0,10)+'T12:00:00').getDay()];
const pctText=v=>v==null?'—':(v>0?'+':'')+String(v).replace('.',',')+'%';
const tone=v=>v==null?'muted':v<0?'bad':v>0?'good':'muted';

// Vendas por semana e por dia dos anuncios listados (fonte: vendas diarias importadas).
export function useSalesBreakdown(rows,anchor='last_day'){
  const [breakdown,setBreakdown]=useState({});
  const ids=(rows||[]).map(r=>r.id).filter(Boolean).join(',');
  useEffect(()=>{
    if(!ids){setBreakdown({});return undefined;}
    const controller=new AbortController();
    fetchCommercialManager('/api/admin/commerce/listings/manager/sales-breakdown?anchor='+anchor+'&ids='+ids,{signal:controller.signal})
      .then(data=>setBreakdown(data?.breakdown||{})).catch(()=>{if(!controller.signal.aborted)setBreakdown({});});
    return()=>controller.abort();
  },[ids,anchor]);
  return breakdown;
}

export function useSalesMonths(rows){
  const [months,setMonths]=useState({});
  const ids=[...new Set((rows||[]).map(r=>r.id).filter(Boolean))];
  const key=ids.join(',');
  useEffect(()=>{
    if(!ids.length){setMonths({});return undefined;}
    const controller=new AbortController();
    const chunks=[];for(let i=0;i<ids.length;i+=200)chunks.push(ids.slice(i,i+200));
    Promise.all(chunks.map(c=>fetchCommercialManager('/api/admin/commerce/listings/manager/sales-months?ids='+c.join(','),{signal:controller.signal})
      .then(data=>data?.months||{}).catch(()=>({}))))
      .then(parts=>{if(!controller.signal.aborted)setMonths(Object.assign({},...parts));});
    return()=>controller.abort();
  },[key]);
  return months;
}

export function WeeklySalesCell({data,open,onToggle,anchored=false,months,monthsOpen,onToggleMonths,showBest=true}){
  const weeks=data?.weeks||[];
  if(!weeks.length)return <span className="ndb-sb-empty">sem dados</span>;
  const cur=weeks[weeks.length-1],prev=weeks[weeks.length-2];
  const d=deltaPct(cur.units,prev?.units);
  const max=Math.max(1,...weeks.map(w=>Number(w.units)||0));
  return <div className="ndb-sb">
    <div className="ndb-sb-weeks" title={anchored?'Unidades por semana de 7 dias, terminando na última venda do anúncio ('+dm(data.last_day)+').':'Unidades vendidas em cada semana de 7 dias, terminando no último dia com venda importada.'}>
      {weeks.map((w,i)=>{const last=i===weeks.length-1;const u=Number(w.units)||0;
        const label=last?(anchored?'até '+dm(data.last_day):'semana atual'):(weeks.length-1-i)+' sem. atrás';
        return <span key={w.end} className={'ndb-sb-week'+(last?' is-cur':'')} title={label+' ('+dm(w.start)+' a '+dm(w.end)+') · '+num(u)+' un. · '+money(w.revenue)}>
        <i className="ndb-sb-bar" style={{height:Math.max(u>0?4:2,u/max*26)+'px'}}/><b>{num(u)}</b></span>;})}
    </div>
    <div className="ndb-sb-meta">
      {d!=null&&<span className={'ndb-sb-delta tone-'+tone(d)} title="Semana atual contra a semana anterior">{pctText(d)}</span>}
      {showBest&&months&&<BestMonthBadge data={months} open={monthsOpen} onToggle={onToggleMonths}/>}
    </div>
  </div>;
}

export function DailySalesRow({data,colSpan,anchored=false}){
  const days=data?.days||[];
  return <tr className="ndb-sb-daily-row"><td colSpan={colSpan}>
    <div className="ndb-sb-days" role="table" aria-label="Vendas por dia, últimos 14 dias">
      {days.map((x,i)=>{
        const before=i>=7?days[i-7]:null;
        const d=before?deltaPct(x.units,before.units):null;
        return <div key={x.day} className="ndb-sb-day" role="row" title={before?'Mesmo dia da semana anterior ('+dm(before.day)+'): '+num(before.units)+' un.':''}>
          <small>{weekday(x.day)} {dm(x.day)}</small><b>{num(x.units)}</b>
          {before?<em className={'tone-'+tone(d)}>{pctText(d)}</em>:<em className="tone-muted">&nbsp;</em>}
        </div>;
      })}
    </div>
    <small className="ndb-note">{anchored?'Unidades por dia nos 14 dias até a última venda ('+dm(data?.last_day)+').':'Unidades por dia nos últimos 14 dias.'} O % compara com o mesmo dia da semana anterior.</small>
  </td></tr>;
}

// Coluna "Melhor mês": mesmo selo, sempre visível, em coluna própria.
export function BestMonthCell({data,open,onToggle}){
  const best=bestMonth(data?.months,data?.last_day);
  if(!best)return <span className="ndb-sb-empty">—</span>;
  return <button type="button" className={'ndb-best-cell'+(open?' is-open':'')} onClick={onToggle} aria-expanded={open}
    title="Mês com mais unidades vendidas deste anúncio (todo o histórico importado). Clique para comparar os meses.">
    <b>{monthLabel(best.month)}</b><small>{num(best.units)} un.{best.ongoing?' · em andamento':''}</small></button>;
}

// Selo "Mes mais vendido": abre a comparacao mes a mes do anuncio.
export function BestMonthBadge({data,open,onToggle}){
  const best=bestMonth(data?.months,data?.last_day);
  if(!best)return null;
  return <button type="button" className={'ndb-best-month'+(open?' is-open':'')} onClick={onToggle} aria-expanded={open}
    title="Mês com mais unidades vendidas deste anúncio (todo o histórico importado). Clique para comparar os meses.">
    <span aria-hidden="true">★</span> Mais vendido: <b>{monthLabel(best.month)}</b> · {num(best.units)} un.{best.ongoing?' (mês em andamento)':''}
  </button>;
}

// Comparacao mes a mes + melhor dia de cada mes; clicar no mes mostra todos os dias dele.
export function MonthsPanelRow({listingId,data,colSpan}){
  const months=data?.months||[];
  const best=bestMonth(months,data?.last_day);
  const [selected,setSelected]=useState(null);
  const [daily,setDaily]=useState(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    if(!selected||daily||failed)return undefined;
    const controller=new AbortController();
    fetchCommercialManager('/api/admin/commerce/listings/manager/sales-months?daily=1&ids='+listingId,{signal:controller.signal})
      .then(r=>setDaily(r?.months?.[String(listingId)]?.daily||[])).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return()=>controller.abort();
  },[selected,daily,failed,listingId]);
  const monthDays=selected&&daily?daily.filter(d=>String(d.day).slice(0,7)===selected):[];
  const peak=monthDays.reduce((m,d)=>Math.max(m,Number(d.units)),0);
  return <tr className="ndb-sb-daily-row ndb-months-row"><td colSpan={colSpan}>
    <table className="ndb-months-table"><thead><tr><th>Mês</th><th className="num">Unidades</th><th className="num">Faturamento</th><th className="num">vs. mês anterior</th><th className="num">Dias com venda</th><th>Melhor dia</th></tr></thead><tbody>
      {months.map((m,i)=>{const prev=months[i-1];const d=prev?deltaPct(m.units,prev.units):null;const isBest=best&&best.month===m.month;
        const ongoing=data?.last_day&&String(data.last_day).slice(0,7)===m.month;
        return <tr key={m.month} className={(isBest?'is-best ':'')+(selected===m.month?'is-selected':'')} onClick={()=>setSelected(selected===m.month?null:m.month)} title="Clique para ver todos os dias deste mês">
          <td><b>{monthLabel(m.month)}</b>{isBest&&<span className="ndb-best-tag">★ mais vendido</span>}{ongoing&&<small className="ndb-note"> até {dm(data.last_day)}</small>}</td>
          <td className="num">{num(m.units)}</td><td className="num">{money(m.revenue)}</td>
          <td className={'num tone-'+tone(d)}>{pctText(d)}</td><td className="num">{num(m.active_days)}</td>
          <td>{dm(m.best_day)} · {num(m.best_units)} un.</td></tr>;})}
    </tbody></table>
    {selected&&<div className="ndb-month-days">
      <small className="ndb-note">Todos os dias de {monthLabel(selected)} (unidades por dia). O dia mais forte aparece em destaque.</small>
      {failed?<small className="ndb-note">Não foi possível carregar os dias agora.</small>:!daily?<small className="ndb-note">Carregando dias…</small>
        :<div className="ndb-sb-days is-month">{monthDays.map(x=><div key={x.day} className={'ndb-sb-day'+(Number(x.units)===peak&&peak>0?' is-peak':'')}><small>{weekday(x.day)} {dm(x.day)}</small><b>{num(x.units)}</b></div>)}</div>}
    </div>}
    <small className="ndb-note">Mês mais vendido = mais unidades no histórico importado. O mês em andamento pode ficar abaixo só por estar incompleto.</small>
  </td></tr>;
}
