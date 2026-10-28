import React,{useEffect,useMemo,useRef,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import { maskMoney } from './commerce-privacy.js';

const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const moneyRaw=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const money=(...a)=>maskMoney(moneyRaw(...a));
const dec=v=>v==null?'—':(Math.round(v*10)/10).toLocaleString('pt-BR',{maximumFractionDigits:1});
const PLAT={SHOPEE:'Shopee',ML:'Mercado Livre'};
const MONTHS_FULL=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const MONTHS_SHORT=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const ymd=d=>String(d||'').slice(0,10);
const dmy=d=>{const s=ymd(d);return s?s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4):'—';};
const monthShort=m=>{const s=ymd(m);return s?cap(MONTHS_SHORT[Number(s.slice(5,7))-1])+'/'+s.slice(2,4):'—';};
const monthFull=m=>{const s=ymd(m);return s?cap(MONTHS_FULL[Number(s.slice(5,7))-1])+' de '+s.slice(0,4):'—';};
const compactMoneyRaw=v=>{const n=Number(v||0);return n>=1000?'R$ '+(n/1000).toLocaleString('pt-BR',{maximumFractionDigits:n>=100000?0:1})+' mil':money(n);};
const compactMoney=(...a)=>maskMoney(compactMoneyRaw(...a));
const norm=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const PAGE=15;

// Um mês só é comparável quando está completo: o primeiro mês do produto (criado no meio do mês) e o mês corrente são parciais.
function partialMonth(month,createdOn,lastDay){
  const m=ymd(month).slice(0,7),first=ymd(createdOn),last=ymd(lastDay);
  if(!m)return false;
  if(first&&m===first.slice(0,7)&&Number(first.slice(8,10))>1)return true;
  if(last&&m===last.slice(0,7)){const end=new Date(Date.UTC(Number(last.slice(0,4)),Number(last.slice(5,7)),0)).getUTCDate();return Number(last.slice(8,10))<end;}
  return false;
}

// Ritmo: unidades por semana desde a criação e comparação dos últimos 28 dias com esse ritmo.
function pace(i){
  const perWeek=i.age_days>0?i.units/i.age_days*7:null;
  let trend=null;
  if(i.age_days>=56&&i.units>=10){const base=i.units/i.age_days*28;if(base>0){const d=(Number(i.u_last28||0)/base-1)*100;trend=d>=15?{cls:'up',txt:'▲ '+Math.round(d)+'%'}:d<=-15?{cls:'down',txt:'▼ '+Math.abs(Math.round(d))+'%'}:{cls:'flat',txt:'≈ estável'};}}
  return {perWeek,trend};
}

function LinkIcon(){return <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/></svg>;}

// Um chip de link por anúncio (um produto pode ter vários anúncios).
function Links({platform,ids,linkFor,max=3}){
  const list=(ids||[]).map(id=>({id,url:linkFor(platform,id)})).filter(l=>l.url);
  if(!list.length)return null;
  return <span className="ndb-coh-links">{list.slice(0,max).map((l,k)=><a key={l.id} className={'ndb-coh-link p-'+String(platform).toLowerCase()} href={l.url} target="_blank" rel="noopener noreferrer" title={'Abrir o anúncio '+l.id+' no '+(PLAT[platform]||platform)}>{list.length>1?'Anúncio '+(k+1):'Abrir anúncio'}<LinkIcon/></a>)}
    {list.length>max&&<span className="ndb-coh-more">+{list.length-max}</span>}</span>;
}

function EarlyBars({item}){
  const steps=[['7d',item.u7],['14d',item.u14],['28d',item.u28],['56d',item.u56]];
  const max=Math.max(1,...steps.map(x=>Number(x[1]||0)));
  return <div className="ndb-coh-bars" role="img" aria-label="Unidades vendidas nos primeiros 7, 14, 28 e 56 dias">
    {steps.map(([l,v])=><div key={l} className={'ndb-coh-bar'+(v==null?' is-na':'')} title={v==null?'Ainda não completou '+l+' de vida':num(v)+' un. nos primeiros '+l}>
      <b>{v==null?'—':num(v)}</b><i style={{height:v==null?2:Math.max(3,Number(v)/max*100)+'%'}}/><small>{l}</small></div>)}
  </div>;
}

function BestMonth({month,units,createdOn,lastDay}){
  if(!month)return <span className="ndb-coh-none">sem vendas</span>;
  const partial=partialMonth(month,createdOn,lastDay);
  return <span title={partial?'Mês incompleto: pode não ser o melhor mês de verdade.':undefined}><b>{monthShort(month)}</b><small>{num(units)} un.{partial?' · parcial':''}</small></span>;
}

function ProductRow({i,lastDay,linkFor,onOpen}){
  const {perWeek,trend}=pace(i);
  const early=i.days_to_first_sale!=null&&i.days_to_first_sale<0;
  const first=i.days_to_first_sale==null?'sem vendas':early?'vendeu antes da data':'1ª venda em '+i.days_to_first_sale+' d';
  return <li className="ndb-coh-row">
    <div className="ndb-coh-prod">
      <button type="button" className="ndb-coh-title" onClick={onOpen} title={i.title+' — ver variações'}>{i.title}</button>
      <small><span className={'ndb-coh-pill p-'+String(i.platform).toLowerCase()}>{PLAT[i.platform]||i.platform}</span>{i.platform==='ML'?i.product_ref+' · '+num(i.listings)+(i.listings===1?' variação':' variações'):i.listing_id+' · SKU '+i.product_ref}</small>
      <Links platform={i.platform} ids={i.listing_ids} linkFor={linkFor}/>
    </div>
    <div className="ndb-coh-when"><b>{dmy(i.created_on)}</b><small>{num(i.age_days)} dias · {first}</small></div>
    <EarlyBars item={i}/>
    <div className="ndb-coh-total"><b>{num(i.units)} un.</b><small>{money(i.revenue)}</small></div>
    <div className="ndb-coh-best"><BestMonth month={i.best_month} units={i.best_month_units} createdOn={i.created_on} lastDay={lastDay}/></div>
    <div className="ndb-coh-pace"><b>{perWeek==null?'—':dec(perWeek)+' /sem'}</b>
      <small title="Unidades nos últimos 28 dias, comparadas ao ritmo médio desde a criação">28d: {num(i.u_last28)} un.{trend&&<em className={'ndb-coh-trend '+trend.cls}>{trend.txt}</em>}</small></div>
    <button type="button" className="ndb-coh-open" onClick={onOpen} aria-label={'Ver variações de '+i.title}>Variações ›</button>
  </li>;
}

// Tela de detalhe: anúncios, vendas por mês e cada variação (SKU) com melhor mês e médias por dia, semana e mês.
function DetailDialog({item,lastDay,linkFor,onClose}){
  const [data,setData]=useState(null);
  const [error,setError]=useState(false);
  const [sel,setSel]=useState('all');
  const closeRef=useRef(null);
  useEffect(()=>{
    const controller=new AbortController();
    setData(null);setError(false);setSel('all');
    fetchCommercialManager('/api/admin/commerce/sales-dashboard/cohorts/detail?platform='+item.platform+'&listing='+encodeURIComponent(item.listing_id),{signal:controller.signal})
      .then(setData).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[item.platform,item.listing_id]);
  useEffect(()=>{
    const prev=document.activeElement;
    closeRef.current?.focus();
    const onKey=e=>{if(e.key==='Escape')onClose();};
    document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('keydown',onKey);prev?.focus?.();};
  },[onClose]);
  const age=item.age_days>0?item.age_days:null;
  const lst=(data?.listings||[]);
  const one=sel!=='all'?lst.find(l=>l.external_id===sel):null;
  const shownMonths=one?(one.months||[]):(data?.months||[]);
  const shownVars=one?(one.variations||[]):(data?.variations||[]);
  const monthsMax=Math.max(1,...shownMonths.map(m=>Number(m.units||0)));
  const bestMonth=shownMonths.filter(m=>!partialMonth(m.month,item.created_on,lastDay)).reduce((a,m)=>(!a||m.units>a.units?m:a),null);
  const avg=u=>age?{d:u/age,w:u/age*7,m:u/age*30}:{d:null,w:null,m:null};
  return <div className="ndb-coh-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="ndb-coh-dialog" role="dialog" aria-modal="true" aria-label={'Variações de '+item.title}>
      <header className="ndb-coh-dhead">
        <div><h3>{item.title}</h3>
          <p><span className={'ndb-coh-pill p-'+String(item.platform).toLowerCase()}>{PLAT[item.platform]||item.platform}</span>{item.platform==='ML'?item.product_ref:item.listing_id+' · SKU '+item.product_ref} · criado em {dmy(item.created_on)} · {num(item.age_days)} dias · {num(item.units)} un. · {money(item.revenue)}</p>
          <Links platform={item.platform} ids={item.listing_ids} linkFor={linkFor} max={8}/></div>
        <button type="button" ref={closeRef} className="ndb-coh-close" onClick={onClose} aria-label="Fechar">×</button>
      </header>
      {error&&<p className="ndb-empty">Consulta indisponível. Feche e tente de novo.</p>}
      {!error&&!data&&<p className="ndb-empty">Carregando…</p>}
      {data&&<div className="ndb-coh-dbody">
        {item.platform!=='ML'&&lst.length>1&&<div className="ndb-coh-ltabs" role="tablist" aria-label="Anúncio do produto">
          <button type="button" role="tab" aria-selected={sel==='all'} className={sel==='all'?'is-active':''} onClick={()=>setSel('all')}>Todos os anúncios <small>{num(data.listings.reduce((a,l)=>a+Number(l.units||0),0))} un.</small></button>
          {lst.map(l=><button key={l.external_id} type="button" role="tab" aria-selected={sel===l.external_id} className={sel===l.external_id?'is-active':''} onClick={()=>setSel(l.external_id)}>{l.external_id} <small>{num(l.units)} un.</small></button>)}
        </div>}
        <h4>{one?'Vendas por mês do anúncio '+one.external_id:'Vendas por mês do produto'}</h4>
        {shownMonths.length===0?<p className="ndb-empty">Sem vendas.</p>:<>
          <div className="ndb-coh-mbars" role="img" aria-label="Unidades vendidas por mês">
            {shownMonths.map(m=>{const partial=partialMonth(m.month,item.created_on,lastDay);const best=bestMonth&&bestMonth.month===m.month;
              return <div key={m.month} className={'ndb-coh-mbar'+(best?' is-best':'')+(partial?' is-partial':'')} title={monthFull(m.month)+': '+num(m.units)+' un. · '+money(m.revenue)+(partial?' (mês incompleto)':'')}>
                <b>{num(m.units)}</b><i style={{height:Math.max(3,Number(m.units)/monthsMax*100)+'%'}}/><small>{monthShort(m.month)}</small></div>;})}
          </div>
          <p className="ndb-note">{bestMonth?'Melhor mês completo: '+monthFull(bestMonth.month)+' com '+num(bestMonth.units)+' un. ':''}Barras claras = mês incompleto.</p></>}
        {(data.listings||[]).length>1&&<><h4>Anúncios do produto</h4>
          <ul className="ndb-coh-llist">{data.listings.map(l=><li key={l.external_id}>
            <Links platform={item.platform} ids={[l.external_id]} linkFor={linkFor}/>
            <span>{l.external_id}</span><span>{num(l.units)} un.</span><span>{money(l.revenue)}</span>
            <span>{l.best_month?'Melhor mês: '+monthShort(l.best_month)+' ('+num(l.best_month_units)+' un.)':'sem vendas'}</span></li>)}</ul></>}
        <h4>{item.platform==='ML'?'Variações (cada MLB)':'Variações'} ({num(shownVars.length)}){one?' · anúncio '+one.external_id:''}</h4>
        <div className="ndb-scroll"><table className="ndb-table ndb-detail-table ndb-coh-vtable">
          <thead><tr><th>Variação</th><th className="num">Vendas</th><th className="num">Faturamento</th><th>Melhor mês</th><th className="num" title="Média desde a criação do produto">Por dia</th><th className="num" title="Média desde a criação do produto">Por semana</th><th className="num" title="Média desde a criação do produto (mês de 30 dias)">Por mês</th><th className="num" title="Unidades nos últimos 28 dias">Últimos 28d</th></tr></thead>
          <tbody>{shownVars.map(v=>{const a=avg(Number(v.units||0));return <tr key={v.sku} className={v.units?'':'ndb-off'}>
            <td><div className="ndb-pc"><div className="ndb-pt"><strong>{v.name||v.sku}</strong>{v.name&&<small>{v.sku}</small>}</div></div></td>
            <td className="num"><b>{num(v.units)}</b></td><td className="num">{money(v.revenue)}</td>
            <td><BestMonth month={v.best_month} units={v.best_month_units} createdOn={item.created_on} lastDay={lastDay}/></td>
            <td className="num">{v.units?dec(a.d):'—'}</td><td className="num">{v.units?dec(a.w):'—'}</td><td className="num">{v.units?dec(a.m):'—'}</td>
            <td className="num">{num(v.u_last28)}</td></tr>;})}
            {shownVars.length===0&&<tr><td colSpan={8} className="ndb-empty">Nenhuma variação encontrada para este produto.</td></tr>}</tbody></table></div>
        <p className="ndb-note">Por dia, semana e mês são médias desde a criação do produto ({num(item.age_days)} dias, mês de 30 dias), contando os dias sem venda. “Últimos 28d” mostra o ritmo mais recente. Variações em cinza não tiveram venda.</p>
      </div>}
    </section>
  </div>;
}

const SORTS=[['recent','Mais recentes'],['units','Mais vendidos'],['pace','Maior ritmo (un./semana)'],['recentpace','Mais vendidos nos últimos 28 dias']];

// Aba "Cadastros por mês": escolha o ano e o mês de criação; a lista é única, ordenada e paginada.
export default function CohortsTab({platform='TODAS',query='',linkFor=()=>null}){
  const [data,setData]=useState(null);
  const [error,setError]=useState(false);
  const [year,setYear]=useState(null);
  const [month,setMonth]=useState(null);
  const [sort,setSort]=useState('recent');
  const [shown,setShown]=useState(PAGE);
  const [openItem,setOpenItem]=useState(null);
  const [yearsOpen,setYearsOpen]=useState(false);
  const [hover,setHover]=useState(null);
  const [shifts,setShifts]=useState({});
  const monthsRef=useRef(null);
  // Ao passar o mouse em um mês, os outros "recuam" na direção do ano; o mês sob o mouse fica parado.
  const hoverMonth=(key,el)=>{
    const box=monthsRef.current;if(!box)return;
    const origin=box.getBoundingClientRect().left;
    const next={};
    box.querySelectorAll('.ndb-coh-m').forEach(b=>{if(b!==el)next[b.dataset.k]=origin-b.getBoundingClientRect().left;});
    setShifts(next);setHover(key);
  };
  useEffect(()=>{
    const controller=new AbortController();
    setData(null);setError(false);
    fetchCommercialManager('/api/admin/commerce/sales-dashboard/cohorts?platform='+platform,{signal:controller.signal})
      .then(setData).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[platform]);
  const all=useMemo(()=>(data?.months||[]).flatMap(m=>(m.items||[]).map(i=>({...i,_month:ymd(m.month).slice(0,7)}))),[data]);
  const years=useMemo(()=>[...new Set(all.map(i=>i._month.slice(0,4)))].sort(),[all]);
  const curYear=year&&years.includes(year)?year:null;
  const qn=norm(query);
  const searched=useMemo(()=>all.filter(i=>!qn||norm(i.title).includes(qn)||norm(i.product_ref).includes(qn)),[all,qn]);
  const inYear=useMemo(()=>curYear?searched.filter(i=>i._month.startsWith(curYear)):searched,[searched,curYear]);
  const counts=useMemo(()=>{const c={};inYear.forEach(i=>{c[i._month.slice(5,7)]=(c[i._month.slice(5,7)]||0)+1;});return c;},[inYear]);
  const sel=useMemo(()=>{
    const list=curYear&&month?inYear.filter(i=>i._month.slice(5,7)===month):inYear.slice();
    const by={recent:(a,b)=>ymd(b.created_on).localeCompare(ymd(a.created_on))||b.units-a.units,
      units:(a,b)=>b.units-a.units,
      pace:(a,b)=>(b.units/(b.age_days||1))-(a.units/(a.age_days||1)),
      recentpace:(a,b)=>b.u_last28-a.u_last28};
    return list.sort(by[sort]);
  },[inYear,month,sort]);
  useEffect(()=>{setShown(PAGE);},[curYear,month,sort,qn,platform]);
  if(error)return <p className="ndb-empty">Consulta indisponível. Tente atualizar.</p>;
  if(!data)return <p className="ndb-empty">Carregando…</p>;
  if(!all.length)return <p className="ndb-empty">Nenhum anúncio com data de criação para esta plataforma.</p>;
  const units=sel.reduce((a,i)=>a+Number(i.units||0),0),rev=sel.reduce((a,i)=>a+Number(i.revenue||0),0);
  return <div className="ndb-coh">
    <div className="ndb-coh-filters">
      <div className="ndb-coh-flow">
        <button type="button" className={'ndb-coh-ano'+(yearsOpen?' is-open':'')} aria-expanded={yearsOpen} onClick={()=>{if(yearsOpen){setYearsOpen(false);setYear(null);setMonth(null);}else setYearsOpen(true);}}>Ano <i aria-hidden="true">›</i></button>
        <div className={'ndb-coh-slide'+(yearsOpen?' is-open':'')} role="group" aria-label="Ano de criação"><div className="ndb-coh-slide-in">
          {years.map(y=><button key={y} type="button" tabIndex={yearsOpen?0:-1} className={y===curYear?'is-active':''} aria-pressed={y===curYear} onClick={()=>{setYear(y===curYear?null:y);setMonth(null);}}>{y}</button>)}</div></div>
        <div className={'ndb-coh-slide'+(curYear?' is-open':'')} role="group" aria-label="Mês de criação" ref={monthsRef}><div className="ndb-coh-slide-in">
          <button type="button" tabIndex={curYear?0:-1} className={!month?'is-active':''} aria-pressed={!month} onClick={()=>setMonth(null)}>Todos <em>{num(inYear.length)}</em></button>
          {MONTHS_SHORT.map((n,k)=>{const key=String(k+1).padStart(2,'0');const c=counts[key]||0;
            if(!c)return null;
            const away=hover&&hover!==key;
            return <button key={key} type="button" tabIndex={curYear?0:-1} data-k={key} className={'ndb-coh-m'+(month===key?' is-active':'')+(away?' is-away':'')} style={away?{transform:'translateX('+(shifts[key]||0)+'px)'}:undefined} aria-pressed={month===key} onClick={()=>setMonth(key)} onMouseEnter={e=>hoverMonth(key,e.currentTarget)} onMouseLeave={()=>setHover(null)}>{cap(n)} <em>{c}</em></button>;})}
        </div></div>
      </div>
      <label className="ndb-coh-sort"><span>Ordenar por</span><select value={sort} onChange={e=>setSort(e.target.value)}>{SORTS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
    </div>
    <p className="ndb-coh-summary"><b>{num(sel.length)}</b> produto{sel.length===1?'':'s'} cadastrado{sel.length===1?'':'s'} em {curYear?(month?monthFull(curYear+'-'+month+'-01'):curYear):'todos os anos'} · <b>{num(units)}</b> un. vendidas · <b>{compactMoney(rev)}</b></p>
    {sel.length===0?<p className="ndb-empty">{qn?'Nenhum produto cadastrado encontrado nessa busca.':'Nenhum produto cadastrado neste período.'}</p>:<>
      <div className="ndb-coh-cols" aria-hidden="true"><span>Produto</span><span>Criado em</span><span>Vendas nos primeiros dias</span><span>Total</span><span>Melhor mês</span><span>Ritmo</span><span/></div>
      <ul className="ndb-coh-list">{sel.slice(0,shown).map(i=><ProductRow key={i.platform+i.listing_id} i={i} lastDay={data.last_day} linkFor={linkFor} onOpen={()=>setOpenItem(i)}/>)}</ul>
      {sel.length>shown&&<button type="button" className="ndb-coh-showmore" onClick={()=>setShown(s=>s+PAGE)}>Mostrar mais {Math.min(PAGE,sel.length-shown)} de {num(sel.length-shown)} restantes</button>}</>}
    <p className="ndb-note">Data de criação vinda da planilha “Análise de Anúncios” ({num(all.length)} anúncios; as variações ficam dentro de cada anúncio. Na Shopee cada anúncio é separado; no Mercado Livre os MLB do mesmo produto aparecem como variações). Vendas contadas até {dmy(data.last_day)}. Compare pelos blocos de 7, 14, 28 e 56 dias, não pelo total, porque produtos mais antigos tiveram mais tempo para vender. A seta do ritmo compara os últimos 28 dias com a média desde a criação (só para produtos com 56+ dias e 10+ vendas). “Parcial” = mês incompleto.</p>
    {openItem&&<DetailDialog item={openItem} lastDay={data.last_day} linkFor={linkFor} onClose={()=>setOpenItem(null)}/>}
  </div>;
}
