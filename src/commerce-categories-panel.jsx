import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {Dropdown} from './commerce-dashboard.jsx';
import {useAnnualCompare} from './commerce-annual-compare.jsx';
import {variation,periodLabel} from './commerce-categories-helpers.js';
import './commerce-categories-panel.css';

// Comparação por categoria, coleção, variação, mês e semana. Valores vêm da API,
// nunca das imagens de referência. Miniaturas são fotos reais do catálogo.
const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const SHORT=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const PLATFORMS=[['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre antigo'],['ML_NOVO','Mercado Livre novo'],['TODAS','Todas as plataformas']];
const fmt=n=>Number(n||0).toLocaleString('pt-BR');
const delta=n=>(Number(n)>0?'+':Number(n)<0?'−':'')+fmt(Math.abs(Number(n)||0));
const pct=(a,b)=>Number(b)>0?(variation(a,b)>0?'+':variation(a,b)<0?'−':'')+Math.abs(variation(a,b)).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'Sem base';
const cleanName=n=>String(n||'').replace(/^[\s\-–—]+/,'');
const rows=a=>Array.isArray(a)?a.filter(Boolean):[];
const num=x=>Number(x)||0;
const validImage=url=>typeof url==='string'&&/^\/api\/images\/\d+(?:\?v=[a-z0-9-]+)?$/i.test(url);
const validLink=url=>typeof url==='string'&&/^https:\/\/[^/\s]+(?:\/|$)/i.test(url);
const color=n=>n>0?'is-up':n<0?'is-down':'is-neutral';
const add=(items,where)=>rows(items).filter(where).reduce((sum,r)=>sum+num(r.units),0);

function Icon({name,size=18}){
  const shapes={
    box:<><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="M3 7v10l9 5 9-5V7M12 12v10"/></>,
    trophy:<><path d="M8 21h8M12 17v4M7 4h10v7a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4v3a4 4 0 0 0 4 4M17 6h3v3a4 4 0 0 1-4 4"/></>,
    up:<><path d="m3 17 6-6 4 4 8-9"/><path d="M15 6h6v6"/></>,
    down:<><path d="m3 7 6 6 4-4 8 9"/><path d="M15 18h6v-6"/></>,
    calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
    layers:<><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></>,
    chart:<><path d="M4 20V4M4 20h17M8 16v-5M13 16V7M18 16V4"/></>,
    link:<><path d="M14 4h6v6M20 4 10 14M18 14v5H5V7h5"/></>,
    search:<><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]||shapes.box}</svg>;
}
function Thumb({src,alt='',size='small'}){
  const [broken,setBroken]=useState(false);
  useEffect(()=>setBroken(false),[src]);
  return <span className={'ndb-cp-thumb is-'+size}>{validImage(src)&&!broken?<img src={src} loading="lazy" alt={alt} onError={()=>setBroken(true)}/>:<Icon name="box" size={size==='large'?23:17}/>}</span>;
}
function useJson(url,refresh=0){
  const [state,setState]=useState({url:'',loading:false,error:'',data:null});
  const [retryCount,setRetryCount]=useState(0);
  useEffect(()=>{
    if(!url){setState({url:'',loading:false,error:'',data:null});return;}
    const controller=new AbortController();
    setState({url,loading:true,error:'',data:null});
    fetchCommercialManager(url,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setState({url,loading:false,error:'',data});})
      .catch(e=>{if(!controller.signal.aborted)setState({url,loading:false,error:e?.message||'Falha na consulta.',data:null});});
    return()=>controller.abort();
  },[url,refresh,retryCount]);
  return state.url===url?{...state,retry:()=>setRetryCount(n=>n+1)}:{url,loading:!!url,error:'',data:null,retry:()=>setRetryCount(n=>n+1)};
}
function Metric({icon,title,value,detail,tone='',onClick,active=false}){
  const inner=<><span className={'ndb-cp-metric-icon '+tone}><Icon name={icon} size={19}/></span><span className="ndb-cp-metric-main"><small>{title}</small><strong title={String(value)}>{value}</strong><span>{detail}</span></span></>;
  return onClick?<button type="button" className={'ndb-cp-metric'+(active?' is-active':'')} onClick={onClick} aria-pressed={active}>{inner}</button>:<div className="ndb-cp-metric">{inner}</div>;
}
function PeriodTag({cur,base}){
  if(!(num(base)>0))return <span className="ndb-cp-tag is-neutral">Sem base</span>;
  return <span className={'ndb-cp-tag '+color(num(cur)-num(base))}>{pct(cur,base)}</span>;
}
function Section({title,subtitle,children,aside,className=''}) {
  return <section className={'ndb-cp-panel '+className}><div className="ndb-cp-panel-head"><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div>{aside}</div>{children}</section>;
}
function PairBars({base,cur,max}){
  return <span className="ndb-cp-pair" aria-label={'Ano anterior: '+fmt(base)+', ano selecionado: '+fmt(cur)}>
    <i className="is-base" style={{width:(num(base)>0?Math.max(3,num(base)/max*100):0)+'%'}}/>
    <i className="is-cur" style={{width:(num(cur)>0?Math.max(3,num(cur)/max*100):0)+'%'}}/>
  </span>;
}
function MonthlyBars({points,onSelect,selected,year,baseYear}){
  const max=Math.max(1,...points.flatMap(p=>[num(p.cur),num(p.base)]));
  return <div className="ndb-cp-month-chart" role="group" aria-label="Comparação mensal de unidades de categorias">
    <div className="ndb-cp-chart-grid" aria-hidden="true">{[100,75,50,25,0].map(x=><span key={x}>{fmt(Math.round(max*x/100))}</span>)}</div>
    {points.map(p=><button type="button" disabled={p.cur==null} key={p.month} onClick={()=>onSelect(p.month)}
      className={'ndb-cp-month-column'+(selected===p.month?' is-selected':'')}
      title={MONTHS[p.month-1]+' '+baseYear+': '+(p.base==null?'sem histórico':fmt(p.base))+' · '+year+': '+(p.cur==null?'não disponível':fmt(p.cur))}
      aria-pressed={selected===p.month}>
      <span className="ndb-cp-month-bars"><i className="is-base" style={{height:(num(p.base)>0?Math.max(3,num(p.base)/max*100):0)+'%'}}/><i className="is-cur" style={{height:(num(p.cur)>0?Math.max(3,num(p.cur)/max*100):0)+'%'}}/></span>
      <small>{SHORT[p.month-1]}</small>
    </button>)}
  </div>;
}
const PAGE_SIZE=10;
const pageOf=(list,page)=>{const pages=Math.max(1,Math.ceil(list.length/PAGE_SIZE)),n=Math.min(Math.max(1,page),pages);return {n,pages,items:list.slice((n-1)*PAGE_SIZE,n*PAGE_SIZE)};};
function Pager({page,total,onPage}) {
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  if(pages<=1)return null;
  return <div className="ndb-cp-pager" role="navigation" aria-label="Paginação"><button type="button" disabled={page<=1} onClick={()=>onPage(page-1)}>‹ Anterior</button><span>Página {page} de {pages} · {fmt(total)} itens</span><button type="button" disabled={page>=pages} onClick={()=>onPage(page+1)}>Próxima ›</button></div>;
}
function DetailTable({heads,children,className=''}) {return <div className="ndb-cp-scroll"><table className={'ndb-cp-table '+className}><thead><tr>{heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}

export default function CommerceCategoriesPanel({filters,setFilters,refresh=0}){
  const cover=useAnnualCompare({platform:'SHOPEE',gran:'month',year:filters.year||null,base:filters.base||null,refresh});
  const coverage=rows(cover.data?.coverage),year=cover.data?Number(cover.data.year):null,baseYear=year?year-1:null;
  const availableYears=[...new Set(coverage.map(c=>num(c.year)).filter(y=>y>=2021&&coverage.some(b=>num(b.year)===y-1&&num(b.units)>0)).concat(year||[]))].filter(Boolean).sort((a,b)=>b-a);
  const units=(plat,y)=>num(coverage.find(c=>c.platform===plat&&num(c.year)===y)?.units);
  const blocked=p=>year&&(p==='TODAS'?['SHOPEE','ML_ANTIGO','ML_NOVO'].some(x=>!units(x,baseYear)):!units(p,baseYear));
  const options=PLATFORMS.map(([id,name])=>[id,name,blocked(id)?'Sem histórico suficiente em '+baseYear:null]);
  useEffect(()=>{if(blocked(filters.platform))setFilters(old=>({...old,platform:'SHOPEE'}));},[filters.platform,year,baseYear,cover.data]);
  const {data,loading,error,retry}=useJson(year?'/api/admin/commerce/sales-compare/categories?platform='+encodeURIComponent(filters.platform)+'&year='+year+'&mode=ytd':'',refresh);
  const [selectedCat,setSelectedCat]=useState(null);
  const [selectedCollection,setSelectedCollection]=useState(null);
  const [monthChoice,setMonthChoice]=useState(0);
  const [selectedWeek,setSelectedWeek]=useState(null);
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState('units');
  const [show,setShow]=useState('all');
  const [varPage,setVarPage]=useState(1);
  const [colPage,setColPage]=useState(1);
  const [catPage,setCatPage]=useState(1);
  const [openYear,setOpenYear]=useState(null);
  const [varScope,setVarScope]=useState('ytd');
  const [allMonths,setAllMonths]=useState(false);
  const categories=rows(data?.categories);
  const picked=categories.find(c=>c.name===selectedCat)||categories[0]||null;
  const asOf=String(data?.as_of||cover.data?.as_of||'');
  const asOfMonth=num(asOf.slice(5,7));
  const currentMonth=monthChoice||Math.max(1,Math.min(12,(asOfMonth||1)-1));
  useEffect(()=>{setSelectedCat(null);setSelectedCollection(null);setSelectedWeek(null);setMonthChoice(0);},[filters.platform,year]);
  useEffect(()=>setSelectedWeek(null),[currentMonth,selectedCat,selectedCollection]);
  const temporalUrl=year&&picked?'/api/admin/commerce/sales-compare/categories-timeline?platform='+encodeURIComponent(filters.platform)
    +'&year='+year+'&month='+currentMonth+'&cat='+encodeURIComponent(picked.name)
    +(selectedCollection?'&sub='+encodeURIComponent(selectedCollection):'')+(selectedWeek?'&week='+selectedWeek:''):'';
  const temporal=useJson(temporalUrl,refresh);
  const t=temporal.data&&num(temporal.data.year)===year&&temporal.data.category===picked?.name
    &&num(temporal.data.month)===currentMonth&&String(temporal.data.collection||'')===String(selectedCollection||'')?temporal.data:null;
  const pics=rows(t?.category_images),imageOf=name=>pics.find(p=>p.category===name)?.image;
  const filtered=useMemo(()=>{
    const q=search.trim().toLocaleLowerCase('pt-BR');
    const f=categories.filter(c=>(!q||c.name.toLocaleLowerCase('pt-BR').includes(q))
      &&(show==='all'||(show==='up'&&num(c.base)>0&&num(c.cur)>num(c.base))
      ||(show==='down'&&num(c.base)>0&&num(c.cur)<num(c.base))||(show==='none'&&c.name==='Sem categoria')));
    const val=c=>sort==='growth'?num(c.cur)-num(c.base):sort==='loss'?num(c.base)-num(c.cur):num(c.cur);
    return f.sort((a,b)=>val(b)-val(a)||a.name.localeCompare(b.name,'pt-BR'));
  },[categories,search,show,sort]);
  const leader=categories.reduce((best,c)=>!best||num(c.cur)>num(best.cur)?c:best,null);
  // A mesma fonte do resumo de categorias já traz coleções classificadas por SKU.
  // Não confundir 'Sem coleção' com uma coleção real no ranking.
  const namedCollections=categories.flatMap(cat=>rows(cat.cols)
    .filter(col=>col.name&&col.name!=='Sem coleção')
    .map(col=>({...col,category:cat.name})));
  const leaderCollection=namedCollections.reduce((a,b)=>!a||num(b.cur)>num(a.cur)?b:a,null);
  const gainCollection=namedCollections.filter(col=>num(col.base)>0&&num(col.cur)>num(col.base))
    .sort((a,b)=>(num(b.cur)-num(b.base))-(num(a.cur)-num(a.base)))[0]||null;
  const lossCollection=namedCollections.filter(col=>num(col.base)>0&&num(col.cur)<num(col.base))
    .sort((a,b)=>(num(a.cur)-num(a.base))-(num(b.cur)-num(b.base)))[0]||null;
  const collectionRows=rows(picked?.cols);
  const catMonths=rows(t?.category_months),collectionMonths=rows(t?.collection_months);
  const months=Array.from({length:12},(_,i)=>{
    const mon=i+1;
    const source=selectedCollection?collectionMonths:catMonths;
    const valid=row=>selectedCollection?row.col===selectedCollection:row.cat===picked?.name;
    const existsBase=source.some(row=>valid(row)&&num(row.month)===mon&&num(row.year)===baseYear);
    const existsCur=source.some(row=>valid(row)&&num(row.month)===mon&&num(row.year)===year);
    const yearCovered=catMonths.some(row=>num(row.month)===mon&&num(row.year)===year);
    return {month:mon,
      base:existsBase?add(source,r=>valid(r)&&num(r.month)===mon&&num(r.year)===baseYear):0,
      cur:mon>asOfMonth?null:existsCur?add(source,r=>valid(r)&&num(r.month)===mon&&num(r.year)===year):yearCovered?0:null,
      catLeader:rows(catMonths).filter(r=>num(r.year)===year&&num(r.month)===mon).sort((a,b)=>num(b.units)-num(a.units))[0]?.cat||'—',
      collectionLeader:rows(collectionMonths).filter(r=>num(r.year)===year&&num(r.month)===mon&&r.col!=='Sem coleção').sort((a,b)=>num(b.units)-num(a.units))[0]?.col||'—'
    };
  });
  const validMonths=months.filter(m=>m.cur!=null),bestMonth=[...validMonths].sort((a,b)=>b.cur-a.cur)[0],worstMonth=[...validMonths].sort((a,b)=>a.cur-b.cur)[0];
  const weeks=Array.from({length:5},(_,i)=>{
    const n=i+1,limit=new Date(year,currentMonth,0).getDate(),start=i*7+1,end=Math.min((i+1)*7,limit);
    if(start>limit||currentMonth>asOfMonth||currentMonth===asOfMonth&&start>num(asOf.slice(8,10)))return null;
    const arr=rows(t?.weekly_collections),filter=r=>selectedCollection?r.col===selectedCollection:true;
    const cur=add(arr,r=>num(r.week)===n&&num(r.year)===year&&filter(r)),base=add(arr,r=>num(r.week)===n&&num(r.year)===baseYear&&filter(r));
    const leaderCollection=arr.filter(r=>num(r.week)===n&&num(r.year)===year&&r.col!=='Sem coleção').sort((a,b)=>num(b.units)-num(a.units))[0]?.col||'—';
    return {week:n,start,end,cur,base,leaderCollection,partial:currentMonth===asOfMonth&&end>num(asOf.slice(8,10))};
  }).filter(Boolean);
  const bestWeek=[...weeks].sort((a,b)=>b.cur-a.cur)[0]||null;
  const worstWeek=[...weeks].sort((a,b)=>a.cur-b.cur)[0]||null;
  const autoKey=(picked?.name||'')+'|'+(selectedCollection||'')+'|'+year;
  const lastWithSales=[...validMonths].reverse().find(m=>num(m.cur)>0);
  useEffect(()=>{
    if(monthChoice===0&&t&&lastWithSales&&validMonths.find(m=>m.month===currentMonth)?.cur===0)setMonthChoice(lastWithSales.month);
  },[autoKey,t,monthChoice]);
  const bestMonthBase=[...validMonths].sort((a,b)=>b.base-a.base)[0],bestWeekBase=[...weeks].sort((a,b)=>b.base-a.base)[0]||null;
  const diffTotal=num(picked?.cur)-num(picked?.base);
  const explainers=[...collectionRows].filter(c=>c.name&&c.name!=='Sem coleção').map(c=>({name:c.name,d:num(c.cur)-num(c.base)})).filter(c=>c.d!==0).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,2);
  const newCols=collectionRows.filter(c=>num(c.base)===0&&num(c.cur)>0),newUnits=newCols.reduce((a,c)=>a+num(c.cur),0);
  const newShare=num(picked?.cur)>0?Math.round(newUnits/num(picked.cur)*100):0;
  const total=data?.total||{cur:0,base:0};
  const maxCats=Math.max(1,...categories.flatMap(c=>[num(c.cur),num(c.base)]));
  useEffect(()=>{setVarPage(1);},[selectedCollection,currentMonth,selectedWeek,selectedCat,year]);
  useEffect(()=>{setCatPage(1);},[search,sort,show,year,filters.platform]);
  useEffect(()=>{setOpenYear(null);},[selectedCat]);
  useEffect(()=>{setVarScope('ytd');},[selectedCollection,selectedCat]);
  useEffect(()=>{setColPage(1);},[selectedCat,search,sort,show,year,currentMonth]);
  const useYtd=varScope==='ytd'&&Array.isArray(t?.products_ytd);
  const varRows=useYtd?rows(t?.products_ytd):rows(t?.products);
  const varCount=num(useYtd?t?.variation_count_ytd:t?.variation_count);
  const selectedProduct=rows(t?.products)[0];
  const chooseCat=name=>{setSelectedCat(name);setSelectedCollection(null);setSelectedWeek(null);};
  const chooseMonth=m=>{setMonthChoice(m);setSelectedWeek(null);setVarScope('month');};
  const handleYear=val=>setFilters(v=>({...v,year:Number(val),base:Number(val)-1,month:'',days:0}));
  return <div className="ndb-cp">
    <div className="ndb-cp-toolbar">
      <div className="ndb-cp-toolbar-info"><strong>Comparação de categorias</strong><small>Vendas por categoria, coleção e variação · meses, semanas e sazonalidade</small></div>
      <Dropdown label="Plataforma" value={filters.platform} options={options} onChange={platform=>setFilters(v=>({...v,platform}))}/>
      <Dropdown label="Comparação" value={String(year||'')} options={availableYears.map(y=>[String(y),y+' × '+(y-1)])} onChange={handleYear}/>
      <label className="ndb-cp-period-select">Mês em destaque<select value={currentMonth} onChange={e=>chooseMonth(Number(e.target.value))}>{MONTHS.slice(0,asOfMonth||1).map((m,i)=><option value={i+1} key={m}>{m}</option>)}</select></label>
      <div className="ndb-cp-search"><Icon name="search" size={16}/><input aria-label="Buscar categoria" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar categoria"/></div>
    </div>
    {data&&<p className="ndb-cp-period">Acumulado até {String(data.cur_to||'').split('-').reverse().join('/')} × {String(data.base_to||'').split('-').reverse().join('/')} · comparação das mesmas datas. Meses futuros do ano selecionado ficam indisponíveis.</p>}
    {cover.error&&<div className="ndb-cp-error" role="alert">{cover.error}</div>}
    {error&&<div className="ndb-cp-error" role="alert">{error}<button type="button" onClick={retry}>Tentar novamente</button></div>}
    {!error&&loading&&<p className="ndb-cp-loading" role="status">Carregando categorias…</p>}
    {data&&!error&&<>
      <div className="ndb-cp-kpis">
        <Metric icon="box" title="Total de unidades" value={fmt(total.cur)} detail={baseYear+': '+fmt(total.base)+' · '+delta(num(total.cur)-num(total.base))+' un.'}/>
        <Metric icon="trophy" title="Categoria líder" value={leader?.name||'—'} detail={leader?fmt(leader.cur)+' unidades · '+(num(total.cur)>0?Math.round(num(leader.cur)/num(total.cur)*100)+'% do total':'—'):'Sem vendas'} onClick={()=>leader&&chooseCat(leader.name)} active={picked?.name===leader?.name}/>
        <Metric icon="trophy" title="Coleção líder" value={leaderCollection?.name||'—'} detail={leaderCollection?fmt(leaderCollection.cur)+' unidades · '+leaderCollection.category:'Nenhuma coleção identificada'} onClick={()=>leaderCollection&&(chooseCat(leaderCollection.category),setSelectedCollection(leaderCollection.name))}/>
        <Metric icon="up" title="Coleção em crescimento" value={gainCollection?.name||'—'} detail={gainCollection?delta(num(gainCollection.cur)-num(gainCollection.base))+' un. · '+gainCollection.category:'Sem crescimento confirmado'} tone="green" onClick={()=>gainCollection&&(chooseCat(gainCollection.category),setSelectedCollection(gainCollection.name))}/>
      </div>
      <div className="ndb-cp-main">
        <Section title="Comparação por categoria" subtitle={baseYear+' × '+year+' · unidades no período comparado'} aside={<div className="ndb-cp-control-row"><select aria-label="Exibir categorias" value={show} onChange={e=>setShow(e.target.value)}><option value="all">Todas</option><option value="up">Crescimento</option><option value="down">Queda</option><option value="none">Sem categoria</option></select><select aria-label="Ordenar categorias" value={sort} onChange={e=>setSort(e.target.value)}><option value="units">Unidades</option><option value="growth">Maior ganho</option><option value="loss">Maior perda</option></select></div>} className="ndb-cp-category-panel">
          <DetailTable heads={['Categoria',String(baseYear),String(year),'Diferença','Variação','Participação']}>
            {pageOf(filtered,catPage).items.map((c,i0)=>{const i=(pageOf(filtered,catPage).n-1)*PAGE_SIZE+i0;return <tr key={c.name} className={picked?.name===c.name?'is-selected':''} onClick={()=>chooseCat(c.name)}>
              <td><button type="button" className="ndb-cp-row-name" onClick={e=>{e.stopPropagation();chooseCat(c.name)}}><Thumb src={imageOf(c.name)} alt={'Produto de '+c.name}/><span><b>{c.name}</b><small>#{i+1}</small></span></button></td>
              <td>{fmt(c.base)}</td><td><b>{fmt(c.cur)}</b><PairBars base={c.base} cur={c.cur} max={maxCats}/></td>
              <td className={color(num(c.cur)-num(c.base))}>{delta(num(c.cur)-num(c.base))}</td>
              <td><PeriodTag cur={c.cur} base={c.base}/></td>
              <td>{num(total.cur)>0?Math.round(num(c.cur)/num(total.cur)*1000)/10+'%':'—'}<span className="ndb-cp-share"><i style={{width:(num(total.cur)>0?num(c.cur)/num(total.cur)*100:0)+'%'}}/></span></td>
            </tr>;})}
          </DetailTable>
          <Pager page={pageOf(filtered,catPage).n} total={filtered.length} onPage={setCatPage}/>
          {!filtered.length&&<p className="ndb-cp-empty">Nenhuma categoria encontrada.</p>}
          <p className="ndb-cp-foot">Selecione uma categoria para investigar coleções, variações, meses e semanas. As fotos são do catálogo.</p>
        </Section>
        <Section title="Categoria selecionada" className="ndb-cp-category-detail">
          {picked?<><div className="ndb-cp-selected"><Thumb size="large" src={imageOf(picked.name)||selectedProduct?.image} alt={'Foto de '+picked.name}/><div><h4>{picked.name}</h4><small>Participação: {num(total.cur)>0?(num(picked.cur)/num(total.cur)*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—'}</small></div></div>
            <div className="ndb-cp-stats">
              <button type="button" className={'ndb-cp-year-cell'+(openYear==='cur'?' is-open':'')} aria-expanded={openYear==='cur'} onClick={()=>setOpenYear(openYear==='cur'?null:'cur')}><small>{year} ▾</small><b>{fmt(picked.cur)}</b></button>
              <button type="button" className={'ndb-cp-year-cell'+(openYear==='base'?' is-open':'')} aria-expanded={openYear==='base'} onClick={()=>setOpenYear(openYear==='base'?null:'base')}><small>{baseYear} ▾</small><b>{fmt(picked.base)}</b></button>
              <div><small>Diferença</small><b className={color(num(picked.cur)-num(picked.base))}>{delta(num(picked.cur)-num(picked.base))}</b></div>
              <div><small>Variação</small><b><PeriodTag cur={picked.cur} base={picked.base}/></b></div>
            </div>
            {openYear&&<p className="ndb-cp-year-detail" role="status"><b>{openYear==='cur'?year:baseYear}:</b> melhor mês <strong>{(openYear==='cur'?bestMonth:bestMonthBase)?SHORT[(openYear==='cur'?bestMonth:bestMonthBase).month-1]+' · '+fmt(openYear==='cur'?bestMonth.cur:bestMonthBase.base):'—'}</strong> · melhor semana de {MONTHS[currentMonth-1]} <strong>{(openYear==='cur'?bestWeek:bestWeekBase)?'Sem. '+(openYear==='cur'?bestWeek:bestWeekBase).week+' · '+fmt(openYear==='cur'?bestWeek.cur:bestWeekBase.base):'—'}</strong></p>}
            <div className="ndb-cp-insights">
              <div><small>Quem explica a variação</small>{explainers.length?explainers.map(e=><span key={e.name}><b>{cleanName(e.name)}</b> <em className={color(e.d)}>{delta(e.d)}</em></span>):<span>—</span>}</div>
              <div><small>Peso dos lançamentos</small><span><b>{newShare}%</b> das vendas vêm de {newCols.length} {newCols.length===1?'coleção sem':'coleções sem'} vendas em {baseYear}{newCols.length?' ('+fmt(newUnits)+' un.)':''}</span></div>
            </div>
            <div className="ndb-cp-panel-subheading"><b>Coleções de {picked.name}</b><button type="button" onClick={()=>setSelectedCollection(null)} disabled={!selectedCollection}>{selectedCollection?'Mostrar todas':'Todas as coleções'}</button></div>
            {temporal.loading?<p className="ndb-cp-loading">Carregando coleções e variações…</p>:temporal.error?<div className="ndb-cp-error">{temporal.error}<button type="button" onClick={temporal.retry}>Tentar novamente</button></div>:null}
            <DetailTable heads={['Coleção',String(baseYear),String(year),'Diferença','Variação','Melhor mês','Melhor semana','']}>
              {pageOf(collectionRows,colPage).items.map(col=>{const cm=rows(collectionMonths).filter(r=>r.col===col.name&&num(r.year)===year).sort((a,b)=>num(b.units)-num(a.units))[0];
                const cw=rows(t?.weekly_collections).filter(r=>r.col===col.name&&num(r.year)===year).sort((a,b)=>num(b.units)-num(a.units))[0];
                const expanded=selectedCollection===col.name;
                return <React.Fragment key={col.name}>
                  <tr className={expanded?'is-selected':''} onClick={()=>{setSelectedCollection(expanded?null:col.name);setSelectedWeek(null)}}>
                    <td><button type="button" className="ndb-cp-sub-button" aria-expanded={expanded} aria-label={(expanded?'Fechar':'Abrir')+' variações da coleção '+col.name} onClick={e=>{e.stopPropagation();setSelectedCollection(expanded?null:col.name);setSelectedWeek(null)}}>{cleanName(col.name)}<span className="ndb-cp-col-arrow">{expanded?'⌄':'›'}</span></button></td>
                    <td>{fmt(col.base)}</td><td><b>{fmt(col.cur)}</b></td>
                    <td className={color(num(col.cur)-num(col.base))}>{delta(num(col.cur)-num(col.base))}</td>
                    <td><PeriodTag cur={col.cur} base={col.base}/></td>
                    <td>{cm?SHORT[num(cm.month)-1]+' · '+fmt(cm.units):'—'}</td>
                    <td>{cw?'Sem. '+cw.week+' · '+fmt(cw.units):'—'}</td>
                    <td className="ndb-cp-arrow">{expanded?'⌄':'›'}</td>
                  </tr>
                  {expanded&&<tr className="ndb-cp-variations-row"><td colSpan={8}>
                    <div className="ndb-cp-variations-panel">
                      <div className="ndb-cp-variations-title"><strong>Variações da coleção {cleanName(col.name)}</strong><span className="ndb-cp-scope"><button type="button" className={useYtd?'is-on':''} onClick={()=>setVarScope('ytd')}>Ano até hoje</button><button type="button" className={!useYtd?'is-on':''} onClick={()=>setVarScope('month')}>{MONTHS[currentMonth-1]}{selectedWeek?' · sem. '+selectedWeek:''}</button></span><small>{baseYear} × {year}</small></div>
                      {temporal.loading?<p className="ndb-cp-loading">Consultando variações…</p>:temporal.error?<p className="ndb-cp-error" role="alert">{temporal.error}</p>:<>
                        {varRows.length?<div className="ndb-cp-variation-list" role="table" aria-label={'Variações da coleção '+col.name}>
                          <div className="ndb-cp-variation-head" role="row"><span/><span>Variação</span><span>{baseYear}</span><span>{year}</span><span>Diferença</span><span>Var.</span><span/></div>
                          {pageOf(varRows,varPage).items.map(v=>{const d=num(v.cur)-num(v.base);return <div key={v.sku} className="ndb-cp-variation-item" role="row">
                          <Thumb src={v.image} alt={v.variation_name||v.name} />
                          <span className="ndb-cp-variation-title"><b>{v.variation_name||v.name||v.sku}</b><small>{v.sku}</small></span>
                          <span className="ndb-cp-vnum is-muted">{fmt(v.base)}</span>
                          <span className="ndb-cp-vnum"><b>{fmt(v.cur)}</b></span>
                          <span className={'ndb-cp-vnum '+color(d)}>{delta(d)}</span>
                          <span className="ndb-cp-vnum"><PeriodTag cur={v.cur} base={v.base}/></span>
                          {validLink(v.url)?<a href={v.url} target="_blank" rel="noopener noreferrer" aria-label={'Abrir anúncio de '+(v.variation_name||v.name)} className="ndb-cp-product-link"><Icon name="link" size={15}/></a>:<span/>}
                        </div>;})}<Pager page={pageOf(varRows,varPage).n} total={varRows.length} onPage={setVarPage}/></div>:<p className="ndb-cp-empty">Nenhuma variação com vendas neste recorte. Tente “Ano até hoje”.</p>}
                        {varCount>varRows.length&&<p className="ndb-cp-foot">Exibindo {varRows.length} de {fmt(varCount)} SKUs com vendas. Ordenado por unidades.</p>}
                      </>}
                    </div>
                  </td></tr>}
                </React.Fragment>;
              })}
            </DetailTable>
            <Pager page={pageOf(collectionRows,colPage).n} total={collectionRows.length} onPage={setColPage}/>
          </>:<p className="ndb-cp-empty">Sem categorias com vendas.</p>}
        </Section>
      </div>
      <div className="ndb-cp-visual-grid">
        <Section title={'Comparação mensal '+(selectedCollection?'da coleção':'da categoria')} subtitle={selectedCollection||picked?.name||''} aside={<div className="ndb-cp-legend"><span><i className="is-base"/>{baseYear}</span><span><i className="is-cur"/>{year}</span></div>}>
          <MonthlyBars points={months} selected={currentMonth} onSelect={chooseMonth} year={year} baseYear={baseYear}/>
          <p className="ndb-cp-foot">Meses futuros do ano atual não são tratados como zero. Clique em um mês para investigar.</p>
        </Section>
        <Section title="Tabela mensal" subtitle={(allMonths?'Todos os meses · ':MONTHS[currentMonth-1]+' · ')+'clique no mês para detalhar semanas · '+(selectedCollection||picked?.name||'')} >
          {allMonths||num(months.find(m=>m.month===currentMonth)?.cur)>0||num(months.find(m=>m.month===currentMonth)?.base)>0?null:<p className="ndb-cp-empty">Sem vendas em {MONTHS[currentMonth-1]} nesse recorte. Escolha outro mês no gráfico ou veja todos os meses.</p>}
          <DetailTable heads={['Mês',String(baseYear),String(year),'Diferença','Variação','Categoria líder','Coleção líder']}>
            {months.filter(m=>m.month<=(asOfMonth||1)&&(allMonths||m.month===currentMonth)).map(m=><tr key={m.month} className={currentMonth===m.month?'is-selected':''} onClick={()=>chooseMonth(m.month)}>
              <td><button type="button" className="ndb-cp-month-button" onClick={e=>{e.stopPropagation();chooseMonth(m.month)}}>{SHORT[m.month-1]}</button></td>
              <td>{fmt(m.base)}</td><td>{m.cur==null?'—':fmt(m.cur)}</td><td className={color(num(m.cur)-num(m.base))}>{m.cur==null?'—':delta(num(m.cur)-num(m.base))}</td>
              <td>{m.cur==null?'—':<PeriodTag cur={m.cur} base={m.base}/>}</td>
              <td>{m.catLeader}</td><td>{m.collectionLeader}</td>
            </tr>)}
          </DetailTable>
          <p className="ndb-cp-foot"><button type="button" className="ndb-cp-link-button" onClick={()=>setAllMonths(v=>!v)}>{allMonths?'Mostrar só o mês em destaque':'Ver todos os meses'}</button></p>
        </Section>
        <Section title="Comparação semanal" subtitle={MONTHS[currentMonth-1]+' · '+(selectedCollection||picked?.name||'')} aside={<div className="ndb-cp-month-arrows"><button type="button" disabled={currentMonth<=1} onClick={()=>chooseMonth(currentMonth-1)} aria-label="Mês anterior">‹</button><b>{SHORT[currentMonth-1]} {year}</b><button type="button" disabled={currentMonth>=asOfMonth} onClick={()=>chooseMonth(currentMonth+1)} aria-label="Próximo mês">›</button></div>}>
          {weeks.some(w=>w.cur>0||w.base>0)?null:<p className="ndb-cp-empty">Sem vendas em {MONTHS[currentMonth-1]} nesse recorte.</p>}
          <DetailTable heads={['Semana',String(baseYear),String(year),'Diferença','Variação','Coleção líder','']}>
            {weeks.map(w=><tr key={w.week} className={selectedWeek===w.week?'is-selected':''} onClick={()=>setSelectedWeek(selectedWeek===w.week?null:w.week)}>
              <td><button type="button" className="ndb-cp-week-button" onClick={e=>{e.stopPropagation();setSelectedWeek(selectedWeek===w.week?null:w.week);setVarScope('month')}}>{String(w.start).padStart(2,'0')}–{String(w.end).padStart(2,'0')}{w.partial?'*':''}</button></td>
              <td>{fmt(w.base)}</td><td><b>{fmt(w.cur)}</b></td><td className={color(w.cur-w.base)}>{delta(w.cur-w.base)}</td><td><PeriodTag cur={w.cur} base={w.base}/></td><td>{w.leaderCollection}</td><td className="ndb-cp-arrow">›</td>
            </tr>)}
          </DetailTable>
          {selectedWeek&&<div className="ndb-cp-week-selected">Semana {selectedWeek} selecionada: as variações mostram somente essa semana. <button type="button" onClick={()=>setSelectedWeek(null)}>Limpar</button></div>}
          <p className="ndb-cp-foot">Semanas: 1–7, 8–14, 15–21, 22–28, 29–fim. * Semana parcial. As vendas são comparadas com a mesma faixa do ano anterior. No mês atual, o ano anterior também é contado só até o mesmo dia.</p>
        </Section>
      </div>
    </>}
  </div>;
}
