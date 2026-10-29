import React,{useEffect,useMemo,useRef,useState} from 'react';

const MON=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const FULL=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const label=m=>{const s=String(m||'');if(/^\d{4}$/.test(s))return 'Ano de '+s;return s.length>=7?FULL[Number(s.slice(5,7))-1].replace(/^./,c=>c.toUpperCase())+' de '+s.slice(0,4):'';};

// Filtro de período: dias fixos, todo o histórico ou "Personalizado" (calendário com os meses que têm vendas; anos aparecem conforme os dados).
export default function PeriodPicker({days,month,periods,available,onDays,onMonth,allowAll=true,yearOption=false,allLabel='Sem filtro (todo o histórico)'}){
  const [open,setOpen]=useState(false);
  const [cal,setCal]=useState(Boolean(month));
  const years=useMemo(()=>[...new Set((available||[]).map(m=>m.slice(0,4)))].sort(),[available]);
  const [year,setYear]=useState(null);
  const ref=useRef(null);
  const shownYear=year&&years.includes(year)?year:(month&&month.slice(0,4))||years[years.length-1]||String(new Date().getFullYear());
  useEffect(()=>{
    if(!open)return undefined;
    const down=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    const key=e=>{if(e.key==='Escape')setOpen(false);};
    document.addEventListener('mousedown',down);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key);};
  },[open]);
  const idx=years.indexOf(shownYear);
  const cur=month?label(month):days===0?allLabel:'Últimos '+days+' dias';
  const pick=fn=>{fn();setOpen(false);};
  return <div className="ndb-dd ndb-pp" ref={ref}>
    <button type="button" className="ndb-dd-btn" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setOpen(o=>!o);setCal(Boolean(month));}}>
      <span>Período</span><b>{cur}</b>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    {open&&<div className="ndb-dd-list ndb-pp-menu" role="dialog" aria-label="Escolher período">
      <ul>
        {periods.map(p=><li key={p}><button type="button" className={!month&&days===p?'is-active':''} onClick={()=>pick(()=>onDays(p))}>Últimos {p} dias</button></li>)}
        {allowAll&&<li><button type="button" className={!month&&days===0?'is-active':''} onClick={()=>pick(()=>onDays(0))}>{allLabel}</button></li>}
        <li><button type="button" className={month||cal?'is-active':''} aria-expanded={cal} onClick={()=>setCal(c=>!c)}>Personalizado… <i aria-hidden="true">{cal?'▴':'▾'}</i></button></li>
      </ul>
      {cal&&<div className="ndb-pp-cal">
        <div className="ndb-pp-year">
          <button type="button" aria-label="Ano anterior" disabled={idx<=0} onClick={()=>setYear(years[idx-1])}>‹</button>
          <b>{shownYear}</b>
          <button type="button" aria-label="Próximo ano" disabled={idx<0||idx>=years.length-1} onClick={()=>setYear(years[idx+1])}>›</button>
        </div>
        <div className="ndb-pp-grid" role="group" aria-label={'Meses de '+shownYear}>
          {MON.map((n,k)=>{const key=shownYear+'-'+String(k+1).padStart(2,'0');const ok=(available||[]).includes(key);
            return <button key={key} type="button" disabled={!ok} className={month===key?'is-active':''} aria-pressed={month===key} title={ok?label(key):'Sem vendas importadas'} onClick={()=>pick(()=>onMonth(key))}>{n}</button>;})}
        </div>
        {yearOption&&<button type="button" className={'ndb-pp-yearall'+(month===shownYear?' is-active':'')} aria-pressed={month===shownYear} disabled={!(available||[]).some(k=>k.startsWith(shownYear+'-'))} onClick={()=>pick(()=>onMonth(shownYear))}>Ano todo de {shownYear}</button>}
        <p>Meses sem vendas importadas ficam desativados.</p>
      </div>}
    </div>}
  </div>;
}
