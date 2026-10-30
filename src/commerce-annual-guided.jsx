import React, {useEffect, useMemo, useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {Dropdown, listingUrl} from './commerce-dashboard.jsx';
import PeriodPicker from './commerce-period-picker.jsx';
import {daysBehind, productLabel} from './commerce-annual-compare-helpers.js';
import './commerce-annual-guided.css';

// Painel GA: apenas unidades; nenhuma projeção ou faturamento é exibida.
// O ano anterior sem vendas não comprova que o anúncio foi criado recentemente.
const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const PLATFORMS=[['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre antigo'],['ML_NOVO','Mercado Livre novo'],['TODAS','Todas as plataformas']];
const fmt=n=>Number(n||0).toLocaleString('pt-BR');
const signed=n=>(Number(n)>0?'+':Number(n)<0?'−':'')+fmt(Math.abs(Number(n)||0));
const percentage=(cur,base)=>Number(base)>0?((Number(cur||0)-Number(base))/Number(base)*100):null;
const pct=n=>n==null?'Sem base':(n>0?'+':n<0?'−':'')+Math.abs(n).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
const iso=(y,m,d)=>String(y)+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
const dayCount=(y,m)=>new Date(y,m,0).getDate();
const plusDays=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const yearAgo=date=>{const d=new Date(date+'T12:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-1);return d.toISOString().slice(0,10);};
const monthShort=m=>MONTHS[m-1]?.slice(0,3)||'—';
const labelPlatform=p=>PLATFORMS.find(row=>row[0]===p)?.[1]||p;
const statusOf=r=>{
  const annual=r?.prior?.y;
  return annual==null?'unknown':Number(annual)>0?'old':'no-history';
};
const cleanRows=rows=>Array.isArray(rows)?rows.filter(Boolean):[];
function Trend({cur,base}) {
  const n=percentage(cur,base);
  return <span className={'ga-y-trend '+(n==null?'is-neutral':n>=0?'is-up':'is-down')}>{pct(n)}</span>;
}
function InsightIcon({kind}) {
  return <span className={'ga-y-card-icon is-'+kind} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {kind==='units'?<><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="M3 7v10l9 5 9-5V7M12 12v10"/></>:
     kind==='months'?<><path d="M3 17.5 9 11l4 4 8-9"/><path d="M15 6h6v6"/></>:
     kind==='extremes'?<><path d="M8 21h8M12 17v4M7 4h10v7a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4v3a4 4 0 0 0 4 4M17 6h3v3a4 4 0 0 1-4 4"/></>:
     <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 18h.01"/></>}
  </svg></span>;
}
function MiniBars({periods,kind}) {
  const rows=cleanRows(periods).slice(-10);
  if(!rows.length)return null;
  const max=Math.max(1,...rows.map(p=>Number(p.cur)||0));
  return <span className="ga-y-card-micro" aria-hidden="true">{rows.map((p,i)=><i key={p.key||i} className={kind==='months'?(Number(p.cur)<Number(p.base)?'is-negative':'is-positive'):'is-volume'} style={{height:Math.max(3,Math.round(23*Number(p.cur||0)/max))+'px'}}/>)}</span>;
}
function DismissibleWarning({children,onClose,label}) {
  return <div className="ga-y-warning ga-y-warning-dismissible" role="status"><span>{children}</span><button type="button" aria-label={label} title="Fechar aviso" onClick={onClose}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6 18 18M18 6 6 18"/></svg></button></div>;
}
function DataCard({title,children,onClick,active=false,description,icon='units',spark=null}) {
  return <button type="button" className={'ga-y-overview-card'+(active?' is-active':'')} onClick={onClick} title={description||title}>
    <span className="ga-y-overview-title"><InsightIcon kind={icon}/><span className="ga-y-title-text">{title}</span><span className="ga-y-card-arrow" aria-hidden="true">↗</span></span>
    <div className="ga-y-overview-content"><div className="ga-y-overview-summary">{children}</div>{spark&&<MiniBars periods={spark} kind={icon}/>}</div>
    <span className="ga-y-overview-action">Investigar <span aria-hidden="true">›</span></span>
  </button>;
}
function ProductLink({row,platform}) {
  const supported=cleanRows(row?.links).filter(l=>platform==='TODAS'||(platform==='SHOPEE'?l.platform==='SHOPEE':l.platform!=='SHOPEE'));
  const first=supported.map(l=>listingUrl(l.platform==='SHOPEE'?'SHOPEE':'ML',l.id)).find(Boolean);
  return first?<a className="ga-y-product-link" href={first} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>Abrir anúncio ↗</a>:<span className="ga-y-muted-inline">Sem link confirmado</span>;
}
function ProductRows({rows,year,baseYear,platform,empty,limit=10}) {
  const [open,setOpen]=useState(null);
  useEffect(()=>setOpen(null),[year,baseYear,platform]);
  if(!rows.length)return <div className="ga-y-empty">{empty||'Nenhum produto neste ranking para o período selecionado.'}</div>;
  return <div className="ga-y-table-scroll"><table className="ga-y-product-table">
    <thead><tr><th>Produto / SKU</th><th>{baseYear}</th><th>{year}</th><th>Diferença</th><th>Variação</th><th>Histórico</th></tr></thead>
    <tbody>{rows.slice(0,limit).map((r,i)=>{
      const old=Number(r.base)||0,cur=Number(r.cur)||0,diff=cur-old;
      const label=productLabel(r.name,r.sku),kind=statusOf(r);
      const ad=cleanRows(r.links).find(l=>l?.id&&(platform==='TODAS'||(platform==='SHOPEE'?l.platform==='SHOPEE':l.platform!=='SHOPEE')));
      const meta=[label.collection,r.category,r.sku,ad?.id?'ID '+ad.id:null].filter(Boolean).join(' · ');
      const key=(r.sku||'sku')+':'+i;
      return <React.Fragment key={key}>
        <tr className={'ga-y-product-row'+(open===key?' is-selected':'')} onClick={()=>setOpen(open===key?null:key)}>
          <td><div className="ga-y-product-cell"><span className="ga-y-product-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9"/></svg></span><span className="ga-y-product-descriptor"><button type="button" onClick={e=>{e.stopPropagation();setOpen(open===key?null:key);}} aria-expanded={open===key} className="ga-y-product-name" title={r.name||r.sku}>{label.title} <span aria-hidden="true">›</span></button><small title={meta}>{meta||'SKU não informado'} · #{i+1}</small></span></div></td>
          <td>{fmt(old)}</td><td><strong>{fmt(cur)}</strong></td>
          <td className={diff>=0?'is-up':'is-down'}>{signed(diff)}</td>
          <td><Trend cur={cur} base={old}/></td>
          <td><span className={'ga-y-history '+(kind==='old'?'is-old':kind==='no-history'?'is-unconfirmed':'')}>{kind==='old'?'Com histórico':kind==='no-history'?'Sem histórico':'A verificar'}</span></td>
        </tr>
        {open===key&&<tr className="ga-y-product-expanded"><td colSpan={6}>
          <div className="ga-y-product-explanation"><span><b>SKU:</b> {r.sku||'—'}</span><span><b>Unidades ganhas/perdidas:</b> {signed(diff)}</span><span><b>Ano-base:</b> {fmt(old)} unidades no período</span><span><b>Classificação:</b> {kind==='old'?'Há vendas registradas no ano-base':kind==='no-history'?'Sem vendas registradas no ano-base; data de criação não confirmada':'Histórico anual não informado pela consulta'}</span><ProductLink row={r} platform={platform}/></div>
        </td></tr>}
      </React.Fragment>;
    })}</tbody>
  </table></div>;
}
function MonthlyListingRows({items,year,baseYear}) {
  const [opened,setOpened]=useState({});
  useEffect(()=>setOpened({}),[items,year,baseYear]);
  if(!items.length)return <div className="ga-y-empty">Nenhum anúncio com vendas registradas em pelo menos um dos dois períodos corresponde aos filtros.</div>;
  return <div className="ga-y-table-scroll"><table className="ga-y-product-table ga-y-listing-table">
    <thead><tr><th>Anúncio / ID</th><th>Variações</th><th>{baseYear}</th><th>{year}</th><th>Diferença</th><th>Variação</th><th>Histórico</th></tr></thead>
    <tbody>{items.map((r,i)=>{
      const id=String(r.id||''),key=String(r.platform)+':'+id,cur=Number(r.cur)||0,base=Number(r.base)||0;
      const variants=cleanRows(r.variations),expanded=Boolean(opened[key]);
      const external=listingUrl(r.platform==='SHOPEE'?'SHOPEE':'ML',id);
      const historyLabel=base>0?'Com vendas em '+baseYear:'Sem vendas em '+baseYear;
      return <React.Fragment key={key}>
        <tr className={'ga-y-product-row'+(expanded?' is-selected':'')}>
          <td><div className="ga-y-product-cell">
            <span className="ga-y-product-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 7h18v4H3zM5 11v10h14V11M9 15h6"/></svg></span>
            <span className="ga-y-product-descriptor">
              <button type="button" className="ga-y-product-name" aria-expanded={expanded} aria-label={(expanded?'Fechar':'Ver')+' variações do anúncio '+id} onClick={()=>setOpened(p=>({...p,[key]:!p[key]}))}>{r.title||'Anúncio '+id}<span aria-hidden="true">{expanded?'⌄':'›'}</span></button>
              <small title={r.platform+' · ID '+id}>{r.platform==='SHOPEE'?'Shopee':r.platform==='ML_ANTIGO'?'Mercado Livre antigo':'Mercado Livre novo'} · ID {id} · #{i+1}</small>
            </span>
          </div></td>
          <td><span className="ga-y-variation-count">{variants.length} SKU{variants.length===1?'':'s'} <span aria-hidden="true">{expanded?'▴':'▾'}</span></span></td>
          <td>{fmt(base)}</td><td><strong>{fmt(cur)}</strong></td>
          <td className={cur>=base?'is-up':'is-down'}>{signed(cur-base)}</td>
          <td><Trend cur={cur} base={base}/></td>
          <td><span className={'ga-y-history '+(base>0?'is-old':'is-unconfirmed')}>{historyLabel}</span></td>
        </tr>
        {expanded&&<tr className="ga-y-product-expanded"><td colSpan={7}>
          <div className="ga-y-listing-detail">
            <div className="ga-y-listing-detail-head"><strong>Variações / SKUs deste anúncio</strong>
              {external&&<a href={external} target="_blank" rel="noopener noreferrer" className="ga-y-product-link">Abrir anúncio ↗</a>}
            </div>
            <table className="ga-y-variation-table"><thead><tr><th>Variação</th><th>SKU</th><th>{baseYear}</th><th>{year}</th><th>Diferença</th><th>Variação</th></tr></thead>
            <tbody>{variants.map((v,j)=>{const vc=Number(v.cur)||0,vb=Number(v.base)||0,recorded=v.recorded!==false;return <tr key={(v.sku||'sku')+':'+j}>
              <td>{v.name||v.sku||'Variação sem nome'}</td><td><small>{v.sku||'—'}</small></td>
              <td>{recorded?fmt(vb):'—'}</td><td><b>{recorded?fmt(vc):'—'}</b></td>
              <td className={recorded?(vc>=vb?'is-up':'is-down'):''}>{recorded?signed(vc-vb):'—'}</td>
              <td>{recorded?<Trend cur={vc} base={vb}/>:<span className="ga-y-history is-unconfirmed">Sem registro</span>}</td>
            </tr>})}</tbody></table>
            <p className="ga-y-note">Variações cadastradas sem vendas identificadas nos dois períodos aparecem como “Sem registro”, não como zero confirmado.</p>
          </div>
        </td></tr>}
      </React.Fragment>;
    })}</tbody>
  </table></div>;
}
function ProductPanel({listingData,loading,error,month,year,baseYear,tab,setTab,history,setHistory,query,setQuery,page,setPage}) {
  const options=[['top','Mais vendidos'],['up','Mais cresceram'],['down','Mais caíram'],['zero','Zeraram'],['no-history','Sem vendas em '+baseYear]];
  const rows=cleanRows(listingData?.items);
  const total=Number(listingData?.total)||0;
  const pages=Math.max(1,Math.ceil(total/15));
  return <section className="ga-y-section" id="ga-y-products">
    <div className="ga-y-section-header"><div><h3>Anúncios de {MONTHS[month-1]}</h3><p>Vendas por anúncio. Clique para abrir as variações e comparar seus SKUs.</p></div><div className="ga-y-product-head-tools"><label className="ga-y-search" htmlFor="ga-y-search"><span>Buscar anúncio</span><input id="ga-y-search" type="search" placeholder="Nome, ID ou SKU" value={query} onChange={e=>setQuery(e.target.value)} maxLength={120}/></label><span className="ga-y-chip">{year} × {baseYear}</span></div></div>
    <div className="ga-y-product-controls">
      <div className="ga-y-segments" role="group" aria-label="Rankings dos anúncios">{options.map(([id,label])=><button type="button" className={tab===id?'is-active':''} aria-pressed={tab===id} onClick={()=>{setTab(id);setHistory('all');setPage(0)}} key={id}>{label}</button>)}</div>
      {tab!=='no-history'&&<label className="ga-y-history-select">Histórico<select value={history} onChange={e=>{setHistory(e.target.value);setPage(0)}}><option value="all">Todos</option><option value="old">Com vendas em {baseYear}</option><option value="no-history">Sem vendas em {baseYear}</option></select></label>}
    </div>
    {tab==='no-history'&&<p className="ga-y-note">Sem vendas em {baseYear} no mês comparado não significa que o anúncio foi criado em {year}.</p>}
    {loading?<div className="ga-y-empty">Carregando anúncios e variações…</div>:error?<p className="ga-y-warning" role="alert">{error}</p>:<MonthlyListingRows items={rows} year={year} baseYear={baseYear}/>}
    {!loading&&!error&&<div className="ga-y-listing-footer"><span>{fmt(total)} anúncios encontrados · página {page+1} de {pages}</span><div className="ga-y-page-actions"><button type="button" disabled={page<=0} onClick={()=>setPage(Math.max(0,page-1))}>Anterior</button><button type="button" disabled={page+1>=pages} onClick={()=>setPage(page+1)}>Próxima</button></div></div>}
    <p className="ga-y-note">Resultados por ID real do anúncio e SKU da venda, sem estimativas. Anúncios sem registro de vendas em ambos os períodos não são classificados como zero automaticamente.</p>
  </section>;
}
function useApi(path,dependencies,enabled=true) {
  const [state,setState]=useState({loading:false,data:null,error:'',path:''});
  useEffect(()=>{
    if(!enabled||!path){setState({loading:false,data:null,error:'',path:''});return;}
    const controller=new AbortController();
    setState({loading:true,data:null,error:'',path});
    fetchCommercialManager(path,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted)setState({loading:false,data,error:'',path});
    }).catch(error=>{
      if(!controller.signal.aborted)setState({loading:false,data:null,error:error?.message||'Falha na consulta',path});
    });
    return()=>controller.abort();
  // O caminho contém todos os filtros relevantes.
  },[path,enabled,...dependencies]);
  return state.path===path?state:{loading:Boolean(enabled),data:null,error:'',path};
}
function MonthComparison({periods,mode,selected,onSelect,year,baseYear,filter,baseAvailable}) {
  const filtered=periods.filter(r=>filter==='all'||(Number(r.base)>0&&(filter==='up'?Number(r.cur)>Number(r.base):Number(r.cur)<Number(r.base))));
  const max=Math.max(1,...periods.flatMap(r=>[Number(r.base)||0,Number(r.cur)||0]));
  if(!filtered.length)return <p className="ga-y-empty">Nenhum mês com dados comparáveis corresponde ao filtro selecionado.</p>;
  if(mode==='chart')return <div className="ga-y-bars-chart" role="group" aria-label="Comparação mensal de unidades">{filtered.map(p=>{
    const m=Number(p.key);return <button type="button" key={m} className={'ga-y-bar-month'+(selected===m?' is-selected':'')} onClick={()=>onSelect(m)} aria-pressed={selected===m} title={MONTHS[m-1]+': '+baseYear+' '+fmt(p.base)+' / '+year+' '+fmt(p.cur)}>
      <span className="ga-y-bar-columns"><i className="is-base" style={{height:Math.max(2,100*Number(p.base||0)/max)+'%'}}/><i className="is-current" style={{height:Math.max(2,100*Number(p.cur||0)/max)+'%'}}/></span><b>{monthShort(m)}</b><small>{baseAvailable?pct(percentage(p.cur,p.base)):'Sem base'}</small>
    </button>;
  })}</div>;
  return <div className="ga-y-table-scroll"><table className="ga-y-month-table"><thead><tr><th>Mês</th><th>{baseYear}</th><th>{year}</th><th>Diferença</th><th>Variação</th></tr></thead><tbody>{filtered.map(p=>{
    const m=Number(p.key),diff=Number(p.cur)-Number(p.base);
    return <tr key={m} className={selected===m?'is-selected':''} onClick={()=>onSelect(m)}><td><button type="button" onClick={()=>onSelect(m)}>{MONTHS[m-1]}</button></td><td>{baseAvailable?fmt(p.base):'—'}</td><td><b>{fmt(p.cur)}</b></td><td className={diff>=0?'is-up':'is-down'}>{baseAvailable?signed(diff):'—'}</td><td>{baseAvailable?<Trend cur={p.cur} base={p.base}/>:<span className="ga-y-muted-inline">Sem base</span>}</td></tr>;
  })}</tbody></table></div>;
}
export default function GuidedAnnualCompare({data,monthData,filters,setFilters,refresh=0}) {
  const [view,setView]=useState('chart');
  const [monthFilter,setMonthFilter]=useState('all');
  const [focus,setFocus]=useState('units');
  const [week,setWeek]=useState(null);
  const [showDays,setShowDays]=useState(false);
  const [productTab,setProductTab]=useState('top');
  const [history,setHistory]=useState('all');
  const [weekRank,setWeekRank]=useState('top');
  const [query,setQuery]=useState('');
  const [listingPage,setListingPage]=useState(0);
  const [listingSearch,setListingSearch]=useState('');
  useEffect(()=>{const timer=setTimeout(()=>setListingSearch(query),350);return()=>clearTimeout(timer);},[query]);
  const [dismissedWarnings,setDismissedWarnings]=useState({});
  const year=Number(data.year),baseYear=Number(data.base_year);
  const asOf=String(data.as_of||'');
  const current=Number(asOf.slice(5,7))||1;
  const previousMonth=current>1?current-1:1;
  const selectedMonth=Number(filters.month)||previousMonth;
  const days=Number(filters.days)||0;
  const windowMode=days>0;
  const allPeriods=cleanRows(data.periods).filter(p=>Number(p.key)>=1&&Number(p.key)<=12&&Number(p.key)<=current);
  const comparable=allPeriods.filter(p=>Number(p.base)>0);
  const up=comparable.filter(p=>Number(p.cur)>Number(p.base));
  const down=comparable.filter(p=>Number(p.cur)<Number(p.base));
  const ranked=comparable.map(p=>({...p,diff:Number(p.cur)-Number(p.base)}));
  const best=ranked.reduce((a,b)=>!a||b.diff>a.diff?b:a,null);
  const worst=ranked.reduce((a,b)=>!a||b.diff<a.diff?b:a,null);
  const period=allPeriods.find(p=>Number(p.key)===selectedMonth);
  const baseAvailable=(()=>{const ps=filters.platform==='TODAS'?['SHOPEE','ML_ANTIGO','ML_NOVO']:[filters.platform];return ps.every(p=>(data.coverage||[]).some(c=>c.platform===p&&Number(c.year)===baseYear&&Number(c.units)>0));})();
  const productValid=monthData&&Number(monthData.year)===year&&monthData.platform===filters.platform&&Number(monthData.month)===selectedMonth;
  const monthly=productValid?monthData:null;
  const update=patch=>setFilters(prev=>({...prev,...patch}));
  const chooseMonth=m=>{update({month:String(m),days:0});setWeek(null);setShowDays(false);setProductTab('top');};
  const yearChoices=[...new Set(cleanRows(data.coverage).map(c=>Number(c.year)).filter(y=>y>=2021&&y<=2100&&(data.coverage||[]).some(b=>Number(b.year)===y-1&&Number(b.units)>0)).concat(year))].sort((a,b)=>b-a);
  const winTo=asOf,winFrom=plusDays(asOf,-(days-1));
  const winBaseTo=yearAgo(winTo),winBaseFrom=yearAgo(winFrom);
  const winUrl=windowMode?'/api/admin/commerce/sales-compare/annual-window?platform='+encodeURIComponent(filters.platform)+'&cur_from='+winFrom+'&cur_to='+winTo+'&base_from='+winBaseFrom+'&base_to='+winBaseTo:'';
  const windowState=useApi(winUrl,[refresh],windowMode);
  const winData=windowState.data?.cur_to===winTo?windowState.data:null;
  const unitCur=windowMode?winData?.total?.cur:data.kpi?.cur;
  const unitBase=windowMode?winData?.total?.base:data.kpi?.base;
  const weekList=cleanRows(monthly?.months).find(r=>Number(r.month)===selectedMonth)?.weeks||[];
  const weeks=cleanRows(weekList).filter(w=>Number(w.n)>=1&&Number(w.n)<=Math.ceil(dayCount(year,selectedMonth)/7)&&Number(w.days||0)>0);
  const lastDay=dayCount(year,selectedMonth);
  const selectedWeek=weeks.find(w=>Number(w.n)===week);
  const weekFrom=week?iso(year,selectedMonth,(week-1)*7+1):'';
  const weekEnd=week?iso(year,selectedMonth,Math.min(lastDay,week*7)):null;
  const weekTo=weekEnd&&weekEnd>asOf&&Number(asOf.slice(0,4))===year?asOf:weekEnd;
  const weekOk=Boolean(weekFrom&&weekTo&&weekFrom<=weekTo);
  const weekUrl=weekOk?'/api/admin/commerce/sales-compare/annual-period-products?platform='+encodeURIComponent(filters.platform)+'&cur_from='+weekFrom+'&cur_to='+weekTo+'&base_from='+yearAgo(weekFrom)+'&base_to='+yearAgo(weekTo):'';
  const weekState=useApi(weekUrl,[refresh],weekOk&&!windowMode);
  const dayUrl=showDays&&week?'/api/admin/commerce/sales-compare/annual-days?platform='+encodeURIComponent(filters.platform)+'&month='+selectedMonth+'&week='+week+'&year='+year+'&base='+baseYear:'';
  const dayState=useApi(dayUrl,[refresh],Boolean(dayUrl)&&!windowMode);
  const winProductsUrl=windowMode&&winData?'/api/admin/commerce/sales-compare/annual-period-products?platform='+encodeURIComponent(filters.platform)+'&cur_from='+winFrom+'&cur_to='+winTo+'&base_from='+winBaseFrom+'&base_to='+winBaseTo:'';
  const winProducts=useApi(winProductsUrl,[refresh],Boolean(winProductsUrl));
  const listingUrlPath=!windowMode&&asOf?
    '/api/admin/commerce/sales-compare/annual-month-listings?platform='+encodeURIComponent(filters.platform)
      +'&month='+selectedMonth+'&year='+year+'&base='+baseYear+'&as_of='+encodeURIComponent(asOf)
      +'&tab='+encodeURIComponent(productTab.toUpperCase().replace('-','_'))
      +'&history='+encodeURIComponent(history.toUpperCase().replace('-','_'))
      +'&search='+encodeURIComponent(listingSearch)+'&limit=15&offset='+(listingPage*15):'';
  const listingState=useApi(listingUrlPath,[refresh],Boolean(listingUrlPath));
  const listingData=listingState.data&&Number(listingState.data.year)===year
    &&Number(listingState.data.month)===selectedMonth&&listingState.data.platform===filters.platform
    ?listingState.data:null;
  useEffect(()=>setListingPage(0),[filters.platform,selectedMonth,year,productTab,history,listingSearch]);

  const late=daysBehind(asOf,new Date().toISOString().slice(0,10));
  useEffect(()=>{setWeek(null);setShowDays(false);setProductTab('top');setHistory('all');},[filters.platform,selectedMonth,year,days]);
  const listingFallCount=listingData?.counts?.down;
  const filterMonths=status=>{setMonthFilter(status);setFocus(status);};
  const sortedWeekRows=cleanRows(weekState.data?.products).filter(r=>!query||String(r.name||'').toLowerCase().includes(query.toLowerCase())||String(r.sku||'').toLowerCase().includes(query.toLowerCase())).sort((a,b)=>weekRank==='down'?(Number(a.cur)-Number(a.base))-(Number(b.cur)-Number(b.base)):weekRank==='up'?(Number(b.cur)-Number(b.base))-(Number(a.cur)-Number(a.base)):Number(b.cur)-Number(a.cur));
  const rawWin=cleanRows(winProducts.data?.products).filter(r=>!query||String(r.name||'').toLowerCase().includes(query.toLowerCase())||String(r.sku||'').toLowerCase().includes(query.toLowerCase()));
  return <div className="ga-y-guided">
    <div className="ga-y-toolbar">
      <Dropdown label="Plataforma" value={filters.platform} options={PLATFORMS} onChange={p=>update({platform:p})}/>
      <Dropdown label="Comparação" value={String(year)} options={yearChoices.map(y=>[String(y),y+' × '+(y-1)])} onChange={y=>update({year:Number(y),base:Number(y)-1,month:'',days:0})}/>
      <PeriodPicker days={days} month={windowMode?'':iso(year,selectedMonth,1).slice(0,7)} periods={[7,30,60,90]} allowAll={false} available={MONTHS.map((_,i)=>iso(year,i+1,1).slice(0,7)).filter((_,i)=>i<current)} onDays={n=>update({days:n,month:''})} onMonth={key=>chooseMonth(Number(String(key).slice(5,7)))}/>
      <span className="ga-y-asof">Dados até {asOf.split('-').reverse().join('/')||'—'}</span>
    </div>
    {late>=2&&!dismissedWarnings['stale:'+asOf]&&<DismissibleWarning label="Fechar aviso de importações desatualizadas" onClose={()=>setDismissedWarnings(p=>({...p,['stale:'+asOf]:true}))}>Importações desatualizadas: o último dado é de {asOf.split('-').reverse().join('/')}. Os resultados recentes podem estar incompletos.</DismissibleWarning>}
    {!baseAvailable&&!dismissedWarnings['coverage:'+filters.platform+':'+baseYear]&&<DismissibleWarning label="Fechar aviso de histórico incompleto" onClose={()=>setDismissedWarnings(p=>({...p,['coverage:'+filters.platform+':'+baseYear]:true}))}>Sem cobertura confirmada de {baseYear} para todas as plataformas escolhidas. Comparações de crescimento exigem histórico importado.</DismissibleWarning>}
    <div className="ga-y-kpis">
      <DataCard title={windowMode?'Unidades nos últimos '+days+' dias':'Unidades no ano'} icon="units" spark={windowMode?null:allPeriods} active={focus==='units'} onClick={()=>{setFocus('units');setMonthFilter('all');document.querySelector('.ga-y-months')?.scrollIntoView({behavior:'smooth',block:'start'});}}>
        <div className="ga-y-kpi-main">{unitCur==null?'—':fmt(unitCur)} {baseAvailable&&unitBase!=null&&<Trend cur={unitCur} base={unitBase}/>}</div>
        <small>{baseYear}: {baseAvailable&&unitBase!=null?fmt(unitBase):'sem base'} {baseAvailable&&unitBase!=null?'· Dif. '+signed(Number(unitCur||0)-Number(unitBase||0)):''}</small>
      </DataCard>
      <DataCard title="Meses em alta / queda" icon="months" spark={allPeriods} active={focus==='up'||focus==='down'} onClick={()=>filterMonths(monthFilter==='down'?'up':'down')} description="Alterna meses em queda e meses em crescimento">
        <div className="ga-y-kpi-split"><span><strong className="is-up">{up.length}</strong><small>Em alta</small></span><span><strong className="is-down">{down.length}</strong><small>Em queda</small></span></div>
        <small>{comparable.length} meses com base comparável</small>
      </DataCard>
      <DataCard title="Maior ganho / maior perda" icon="extremes" active={focus==='best'||focus==='worst'} onClick={()=>{const next=focus==='worst'?'best':'worst';const target=next==='best'?best:worst;if(target){chooseMonth(Number(target.key));setFocus(next);setMonthFilter('all');}}}>
        <div className="ga-y-kpi-split"><span><strong>{best?monthShort(Number(best.key)):'—'}</strong><small className="is-up">{best?signed(best.diff):'sem base'} un.</small></span><span><strong>{worst?monthShort(Number(worst.key)):'—'}</strong><small className="is-down">{worst?signed(worst.diff):'sem base'} un.</small></span></div>
        <small>Diferença absoluta de unidades vs. {baseYear}</small>
      </DataCard>
      <DataCard title="Anúncios em queda no mês" icon="alerts" active={focus==='alerts'} onClick={()=>{setFocus('alerts');setProductTab('down');setHistory('old');document.getElementById('ga-y-products')?.scrollIntoView({behavior:'smooth',block:'start'});}}>
        <div className="ga-y-kpi-main">{listingFallCount==null?'—':fmt(listingFallCount)} <span className="ga-y-kpi-qualifier">anúncios identificados</span></div>
        <small>{MONTHS[selectedMonth-1]} · clique para investigar os anúncios</small>
      </DataCard>
    </div>
    {windowMode?<section className="ga-y-section ga-y-window">
      <div className="ga-y-section-header"><div><h3>Últimos {days} dias</h3><p>Comparação com o mesmo intervalo de {baseYear}.</p></div><span className="ga-y-chip">{winFrom} a {winTo}</span></div>
      {windowState.loading?<p className="ga-y-empty">Carregando comparação…</p>:windowState.error?<p className="ga-y-warning">{windowState.error}</p>:<div className="ga-y-window-kpis"><div><small>{year}</small><strong>{fmt(winData?.total?.cur)}</strong></div><div><small>{baseYear}</small><strong>{baseAvailable?fmt(winData?.total?.base):'—'}</strong></div><div><small>Diferença</small><strong>{baseAvailable?signed(Number(winData?.total?.cur||0)-Number(winData?.total?.base||0)):'—'}</strong></div><div><small>Variação</small>{baseAvailable?<Trend cur={winData?.total?.cur} base={winData?.total?.base}/>:<span>—</span>}</div></div>}
      <h3>Produtos do período</h3>
      {winProducts.loading?<p className="ga-y-empty">Carregando produtos…</p>:winProducts.error?<p className="ga-y-warning">{winProducts.error}</p>:<ProductRows rows={rawWin} year={year} baseYear={baseYear} platform={filters.platform} limit={40}/>}
      <p className="ga-y-note">A API do período retorna até 40 produtos. Não confunda ausência da lista com zero vendas.</p>
    </section>:<>
      <div className="ga-y-body">
        <section className={"ga-y-section ga-y-months"+(view==="chart"?" is-chart":"")}>
          <div className="ga-y-section-header"><div><h3>Evolução mensal de unidades vendidas</h3><p>Comparação {year} × {baseYear} · selecione um mês para investigar.</p></div><div className="ga-y-heading-tools">
            <div className="ga-y-legend"><span><i className="is-base"/>{baseYear}</span><span><i className="is-current"/>{year}</span></div>
            <div className="ga-y-segments"><button type="button" className={view==='chart'?'is-active':''} onClick={()=>setView('chart')}>Gráfico</button><button type="button" className={view==='table'?'is-active':''} onClick={()=>setView('table')}>Tabela</button></div>
          </div></div>
          <div className="ga-y-month-filter"><button type="button" className={monthFilter==='all'?'is-active':''} onClick={()=>filterMonths('all')}>Todos</button><button type="button" className={monthFilter==='up'?'is-active':''} onClick={()=>filterMonths('up')}>Em alta ({up.length})</button><button type="button" className={monthFilter==='down'?'is-active':''} onClick={()=>filterMonths('down')}>Em queda ({down.length})</button></div>
          <MonthComparison periods={allPeriods} selected={selectedMonth} mode={view} onSelect={chooseMonth} year={year} baseYear={baseYear} filter={monthFilter} baseAvailable={baseAvailable}/>
          <p className="ga-y-note">Mês parcial é comparado somente até a data correspondente. Sem importação confirmada, não se presume zero vendas.</p>
        </section>
        <aside className="ga-y-section ga-y-investigation">
          <div className="ga-y-section-header"><div><h3>Investigação do mês</h3><p>{MONTHS[selectedMonth-1]} · {labelPlatform(filters.platform)}</p></div><div className="ga-y-month-nav"><button type="button" disabled={selectedMonth<=1} onClick={()=>chooseMonth(selectedMonth-1)} aria-label="Mês anterior">‹</button><span>{monthShort(selectedMonth)} {year}</span><button type="button" disabled={selectedMonth>=current} onClick={()=>chooseMonth(selectedMonth+1)} aria-label="Próximo mês">›</button></div></div>
          <div className="ga-y-month-summary">
            <div><small>Unidades no mês</small><strong>{period?fmt(period.cur):'—'}</strong><small>{baseYear}: {baseAvailable&&period?fmt(period.base):'—'}</small></div>
            <div><small>Diferença</small><strong>{period&&baseAvailable?signed(Number(period.cur)-Number(period.base)):'—'}</strong><small>{period&&baseAvailable?pct(percentage(period.cur,period.base)):'Sem base comparável'}</small></div>
          </div>
          <div className="ga-y-section-header ga-y-subhead"><h4>Desempenho semanal</h4><button type="button" onClick={()=>{setWeek(null);setShowDays(false)}}>Limpar seleção</button></div>
          {!productValid?<p className="ga-y-empty">Consultando semanas do mês…</p>:weeks.length===0?<p className="ga-y-empty">Sem dados semanais disponíveis.</p>:<div className="ga-y-table-scroll"><table className="ga-y-weeks-table">
            <thead><tr><th>Semana</th><th>{baseYear}</th><th>{year}</th><th>Diferença</th><th>Variação</th></tr></thead>
            <tbody>{weeks.map(w=>{const n=Number(w.n),start=(n-1)*7+1,end=Math.min(n*7,lastDay),diff=Number(w.cur)-Number(w.base);
              return <tr key={n} className={week===n?'is-selected':''} onClick={()=>{setWeek(n);setShowDays(false);}}><td><button type="button" onClick={()=>{setWeek(n);setShowDays(false);}}>{start}–{end}{n===5?'*':''}</button></td><td>{baseAvailable?fmt(w.base):'—'}</td><td><b>{fmt(w.cur)}</b></td><td className={diff>=0?'is-up':'is-down'}>{baseAvailable?signed(diff):'—'}</td><td>{baseAvailable?<Trend cur={w.cur} base={w.base}/>:<span>—</span>}</td></tr>;
            })}</tbody>
          </table></div>}
          {week!=null&&<div className="ga-y-week-detail">
            <div className="ga-y-section-header ga-y-subhead"><h4>Semana {week===5?'29+':(week-1)*7+1+'–'+Math.min(week*7,lastDay)}</h4><button type="button" onClick={()=>setShowDays(v=>!v)}>{showDays?'Ocultar dias':'Ver dias'}</button></div>
            {selectedWeek&&<p className="ga-y-week-note">Resultado: {fmt(selectedWeek.cur)} unidades · diferença {baseAvailable?signed(Number(selectedWeek.cur)-Number(selectedWeek.base)):'sem base'}.</p>}
            {showDays&&(dayState.loading?<p className="ga-y-empty">Consultando dias…</p>:dayState.error?<p className="ga-y-warning">{dayState.error}</p>:<div className="ga-y-table-scroll"><table className="ga-y-days-table"><thead><tr><th>Dia</th><th>{baseYear}</th><th>{year}</th><th>Diferença</th></tr></thead><tbody>{cleanRows(dayState.data?.days).filter(d=>Number(d.day)>=(week-1)*7+1&&Number(d.day)<=week*7).map(d=><tr key={d.day}><td>{d.day}/{String(selectedMonth).padStart(2,'0')}</td><td>{d.base==null?'—':fmt(d.base)}</td><td>{d.cur==null?'—':fmt(d.cur)}</td><td>{d.base==null||d.cur==null?'—':signed(Number(d.cur)-Number(d.base))}</td></tr>)}</tbody></table><p className="ga-y-note">“—” = sem cobertura diária confirmada, não zero vendas.</p></div>)}
          </div>}
          <p className="ga-y-note">Selecione uma semana para abrir os produtos correspondentes abaixo.</p>
        </aside>
      </div>
      <div className="ga-y-body ga-y-products-body">
        <div className="ga-y-product-left">
          <ProductPanel listingData={listingData} loading={listingState.loading} error={listingState.error} month={selectedMonth} year={year} baseYear={baseYear} tab={productTab} setTab={setProductTab} history={history} setHistory={setHistory} query={query} setQuery={setQuery} page={listingPage} setPage={setListingPage}/>
        </div>
        <section className="ga-y-section ga-y-week-products">
          <div className="ga-y-section-header"><div><h3>{week?'Produtos da semana '+(week===5?'29+':(week-1)*7+1+'–'+Math.min(week*7,lastDay)):'Produtos da semana'}</h3><p>Selecione uma semana na investigação para comparar seus SKUs.</p></div></div>
          {week==null?<div className="ga-y-empty">Clique em uma semana na tabela superior para mostrar seus produtos.</div>:<>
            <div className="ga-y-segments"><button type="button" className={weekRank==='top'?'is-active':''} onClick={()=>setWeekRank('top')}>Mais vendidos</button><button type="button" className={weekRank==='up'?'is-active':''} onClick={()=>setWeekRank('up')}>Mais cresceram</button><button type="button" className={weekRank==='down'?'is-active':''} onClick={()=>setWeekRank('down')}>Mais caíram</button></div>
            {weekState.loading?<div className="ga-y-empty">Carregando produtos da semana…</div>:weekState.error?<p className="ga-y-warning">{weekState.error}</p>:<ProductRows rows={sortedWeekRows.filter(r=>weekRank==='down'?Number(r.cur)<Number(r.base):weekRank==='up'?Number(r.cur)>Number(r.base):true)} year={year} baseYear={baseYear} platform={filters.platform}/>}
            <p className="ga-y-note">Ranking calculado entre os produtos retornados pela consulta do período (até 40); não equivale ao catálogo completo.</p>
          </>}
        </section>
      </div>
    </>}
  </div>;
}
