import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {deltaPct} from './commerce-sales-breakdown-helpers.js';

const num=v=>Number(v||0).toLocaleString('pt-BR');
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dm=v=>String(v||'').slice(0,10).split('-').reverse().slice(0,2).join('/');
const WEEKDAY=['dom','seg','ter','qua','qui','sex','sáb'];
const weekday=v=>WEEKDAY[new Date(String(v).slice(0,10)+'T12:00:00').getDay()];
const pctText=v=>v==null?'—':(v>0?'+':'')+String(v).replace('.',',')+'%';
const tone=v=>v==null?'muted':v<0?'bad':v>0?'good':'muted';

// Vendas por semana e por dia dos anuncios listados (fonte: vendas diarias importadas).
export function useSalesBreakdown(rows){
  const [breakdown,setBreakdown]=useState({});
  const ids=(rows||[]).map(r=>r.id).filter(Boolean).join(',');
  useEffect(()=>{
    if(!ids){setBreakdown({});return undefined;}
    const controller=new AbortController();
    fetchCommercialManager('/api/admin/commerce/listings/manager/sales-breakdown?ids='+ids,{signal:controller.signal})
      .then(data=>setBreakdown(data?.breakdown||{})).catch(()=>{if(!controller.signal.aborted)setBreakdown({});});
    return()=>controller.abort();
  },[ids]);
  return breakdown;
}

export function WeeklySalesCell({data,open,onToggle}){
  const weeks=data?.weeks||[];
  if(!weeks.length)return <span className="ndb-sb-empty">sem dados</span>;
  const cur=weeks[weeks.length-1],prev=weeks[weeks.length-2];
  const d=deltaPct(cur.units,prev?.units);
  return <div className="ndb-sb">
    <div className="ndb-sb-weeks" title="Unidades vendidas em cada semana de 7 dias, terminando no último dia com venda importada.">
      {weeks.map((w,i)=><span key={w.end} className={'ndb-sb-week'+(i===weeks.length-1?' is-cur':'')} title={dm(w.start)+' a '+dm(w.end)+' · '+money(w.revenue)}>
        <small>{i===weeks.length-1?'Atual':'-'+(weeks.length-1-i)+' sem.'}</small><b>{num(w.units)}</b></span>)}
    </div>
    <span className={'ndb-sb-delta tone-'+tone(d)} title="Semana atual contra a semana anterior">{pctText(d)} vs. semana anterior</span>
    <button type="button" className="ndb-link" onClick={onToggle} aria-expanded={open}>{open?'Ocultar dias':'Ver por dia'}</button>
  </div>;
}

export function DailySalesRow({data,colSpan}){
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
    <small className="ndb-note">Unidades por dia nos últimos 14 dias. O % compara com o mesmo dia da semana anterior.</small>
  </td></tr>;
}
