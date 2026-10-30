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
function Seasonality({points,onSelect,selected,year,baseYear}){
  const W=660,H=186,P=28,plotH=135;
  const max=Math.max(1,...points.flatMap(p=>[num(p.cur),num(p.base)]));
  const path=field=>points.map((p,i)=>p[field]==null?null:{x:P+i*(W-P*2)/11,y:H-27-num(p[field])/max*plotH,month:p.month}).reduce((segments,point)=>{if(!point){segments.push([]);}else{if(!segments.length||!segments[segments.length-1])segments.push([]);segments[segments.length-1].push(point);}return segments;},[[]]).filter(s=>s.length).map(s=>s.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' '));
  return <div className="ndb-cp-season-wrap"><svg viewBox={'0 0 '+W+' '+H} role="img" aria-label={'Sazonalidade mensal: '+baseYear+' em cinza e '+year+' em azul'}>
    {[0,0.25,0.5,0.75,1].map(f=><g key={f}><line x1={P} y1={H-27-f*plotH} x2={W-P} y2={H-27-f*plotH} stroke="#e5eaf2" strokeDasharray="3 3"/><text x={P-5} y={H-23-f*plotH} fontSize="9" textAnchor="end" fill="#718098">{fmt(Math.round(max*f))}</text></g>)}
    {path('base').map((d,i)=><path key={'b'+i} d={d} stroke="#aab9d2" strokeWidth="2.6" fill="none" strokeLinejoin="round" strokeLinecap="round"/>)}
    {path('cur').map((d,i)=><path key={'c'+i} d={d} stroke="#2563eb" strokeWidth="2.8" fill="none" strokeLinejoin="round" strokeLinecap="round"/>)}
    {points.map((p,i)=><g key={p.month}>
      {p.base!=null&&<circle cx={P+i*(W-P*2)/11} cy={H-27-num(p.base)/max*plotH} r="3.3" fill="#aab9d2"/>}
      {p.cur!=null&&<circle cx={P+i*(W-P*2)/11} cy={H-27-num(p.cur)/max*plotH} r={selected===p.month?5.5:3.8} fill="#2563eb" stroke={selected===p.month?'white':'none'} strokeWidth="1.5"/>}
      <text x={P+i*(W-P*2)/11} y={H-4} textAnchor="middle" fontSize="10" fill={selected===p.month?'#2563eb':'#64748b'} fontWeight={selected===p.month?'800':'500'}>{SHORT[i]}</text>
    </g>)}
  </svg><div className="ndb-cp-season-actions">{points.map(p=><button type="button" key={p.month} title={'Selecionar '+MONTHS[p.month-1]} aria-label={'Selecionar '+MONTHS[p.month-1]} className={selected===p.month?'is-active':''} disabled={p.cur==null} onClick={()=>onSelect(p.month)} />)}</div></div>;
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
  const total=data?.total||{cur:0,base:0};
  const maxCats=Math.max(1,...categories.flatMap(c=>[num(c.cur),num(c.base)]));
  const selectedProduct=rows(t?.products)[0];
  const chooseCat=name=>{setSelectedCat(name);setSelectedCollection(null);setSelectedWeek(null);};
  const chooseMonth=m=>{setMonthChoice(m);setSelectedWeek(null);};
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
        <Metric icon="down" title="Coleção em queda" value={lossCollection?.name||'—'} detail={lossCollection?delta(num(lossCollection.cur)-num(lossCollection.base))+' un. · '+lossCollection.category:'Sem queda confirmada'} tone="red" onClick={()=>lossCollection&&(chooseCat(lossCollection.category),setSelectedCollection(lossCollection.name))}/>
      </div>
      <div className="ndb-cp-main">
        <Section title="Comparação por categoria" subtitle={baseYear+' × '+year+' · unidades no período comparado'} aside={<div className="ndb-cp-control-row"><select aria-label="Exibir categorias" value={show} onChange={e=>setShow(e.target.value)}><option value="all">Todas</option><option value="up">Crescimento</option><option value="down">Queda</option><option value="none">Sem categoria</option></select><select aria-label="Ordenar categorias" value={sort} onChange={e=>setSort(e.target.value)}><option value="units">Unidades</option><option value="growth">Maior ganho</option><option value="loss">Maior perda</option></select></div>} className="ndb-cp-category-panel">
          <DetailTable heads={['Categoria',String(baseYear),String(year),'Diferença','Variação','Participação']}>
            {filtered.map((c,i)=><tr key={c.name} className={picked?.name===c.name?'is-selected':''} onClick={()=>chooseCat(c.name)}>
              <td><button type="button" className="ndb-cp-row-name" onClick={e=>{e.stopPropagation();chooseCat(c.name)}}><Thumb src={imageOf(c.name)} alt={'Produto de '+c.name}/><span><b>{c.name}</b><small>#{i+1}</small></span></button></td>
              <td>{fmt(c.base)}</td><td><b>{fmt(c.cur)}</b><PairBars base={c.base} cur={c.cur} max={maxCats}/></td>
              <td className={color(num(c.cur)-num(c.base))}>{delta(num(c.cur)-num(c.base))}</td>
              <td><PeriodTag cur={c.cur} base={c.base}/></td>
              <td>{num(total.cur)>0?Math.round(num(c.cur)/num(total.cur)*1000)/10+'%':'—'}<span className="ndb-cp-share"><i style={{width:(num(total.cur)>0?num(c.cur)/num(total.cur)*100:0)+'%'}}/></span></td>
            </tr>)}
          </DetailTable>
          {!filtered.length&&<p className="ndb-cp-empty">Nenhuma categoria encontrada.</p>}
          <p className="ndb-cp-foot">Selecione uma categoria para investigar coleções, variações, meses e semanas. As fotos são do catálogo.</p>
        </Section>
        <Section title="Categoria selecionada" aside={<button type="button" className="ndb-cp-view-products" onClick={()=>document.getElementById("ndb-cp-products")?.scrollIntoView({behavior:"smooth",block:"start"})}><Icon name="box" size={14}/> Ver produtos</button>} className="ndb-cp-category-detail">
          {picked?<><div className="ndb-cp-selected"><Thumb size="large" src={imageOf(picked.name)||selectedProduct?.image} alt={'Foto de '+picked.name}/><div><h4>{picked.name}</h4><small>Participação: {num(total.cur)>0?(num(picked.cur)/num(total.cur)*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—'}</small></div></div>
            <div className="ndb-cp-stats">
              <div><small>{year}</small><b>{fmt(picked.cur)}</b></div>
              <div><small>{baseYear}</small><b>{fmt(picked.base)}</b></div>
              <div><small>Diferença</small><b className={color(num(picked.cur)-num(picked.base))}>{delta(num(picked.cur)-num(picked.base))}</b></div>
              <div><small>Variação</small><b><PeriodTag cur={picked.cur} base={picked.base}/></b></div>
              <div><small>Melhor mês</small><b>{bestMonth?SHORT[bestMonth.month-1]:'—'}</b></div>
              <div><small>Menor mês</small><b>{worstMonth?SHORT[worstMonth.month-1]:'—'}</b></div>
              <div><small>Melhor semana (mês)</small><b>{bestWeek?'Sem. '+bestWeek.week:'—'}</b></div>
              <div><small>Menor semana (mês)</small><b>{worstWeek?'Sem. '+worstWeek.week:'—'}</b></div>
            </div>
            <div className="ndb-cp-panel-subheading"><b>Coleções de {picked.name}</b><button type="button" onClick={()=>setSelectedCollection(null)} disabled={!selectedCollection}>{selectedCollection?'Mostrar todas':'Todas as coleções'}</button></div>
            {temporal.loading?<p className="ndb-cp-loading">Carregando coleções e variações…</p>:temporal.error?<div className="ndb-cp-error">{temporal.error}<button type="button" onClick={temporal.retry}>Tentar novamente</button></div>:null}
            <DetailTable heads={['Coleção',String(baseYear),String(year),'Diferença','Variação','Melhor mês','Melhor semana','']}>
              {collectionRows.map(col=>{const cm=rows(collectionMonths).filter(r=>r.col===col.name&&num(r.year)===year).sort((a,b)=>num(b.units)-num(a.units))[0];
                const cw=rows(t?.weekly_collections).filter(r=>r.col===col.name&&num(r.year)===year).sort((a,b)=>num(b.units)-num(a.units))[0];
                const expanded=selectedCollection===col.name;
                return <React.Fragment key={col.name}>
                  <tr className={expanded?'is-selected':''} onClick={()=>{setSelectedCollection(expanded?null:col.name);setSelectedWeek(null)}}>
                    <td><button type="button" className="ndb-cp-sub-button" aria-expanded={expanded} aria-label={(expanded?'Fechar':'Abrir')+' variações da coleção '+col.name} onClick={e=>{e.stopPropagation();setSelectedCollection(expanded?null:col.name);setSelectedWeek(null)}}>{col.name}<span className="ndb-cp-col-arrow">{expanded?'⌄':'›'}</span></button></td>
                    <td>{fmt(col.base)}</td><td><b>{fmt(col.cur)}</b></td>
                    <td className={color(num(col.cur)-num(col.base))}>{delta(num(col.cur)-num(col.base))}</td>
                    <td><PeriodTag cur={col.cur} base={col.base}/></td>
                    <td>{cm?SHORT[num(cm.month)-1]+' · '+fmt(cm.units):'—'}</td>
                    <td>{cw?'Sem. '+cw.week+' · '+fmt(cw.units):'—'}</td>
                    <td className="ndb-cp-arrow">{expanded?'⌄':'›'}</td>
                  </tr>
                  {expanded&&<tr className="ndb-cp-variations-row"><td colSpan={8}>
                    <div className="ndb-cp-variations-panel">
                      <div className="ndb-cp-variations-title"><strong>Variações da coleção {col.name}</strong><small>{MONTHS[currentMonth-1]}{selectedWeek?' · semana '+selectedWeek:''} · {baseYear} × {year}</small></div>
                      {temporal.loading?<p className="ndb-cp-loading">Consultando variações…</p>:temporal.error?<p className="ndb-cp-error" role="alert">{temporal.error}</p>:<>
                        {rows(t?.products).length?<div className="ndb-cp-variation-list">{rows(t?.products).map(v=><div key={v.sku} className="ndb-cp-variation-item">
                          <Thumb src={v.image} alt={v.variation_name||v.name} />
                          <span className="ndb-cp-variation-title"><b>{v.variation_name||v.name||v.sku}</b><small>SKU: {v.sku}</small></span>
                          <span className="ndb-cp-variation-units">{baseYear}: {fmt(v.base)}<strong>{year}: {fmt(v.cur)}</strong><em className={color(num(v.cur)-num(v.base))}>{delta(num(v.cur)-num(v.base))}</em></span>
                          {validLink(v.url)&&<a href={v.url} target="_blank" rel="noopener noreferrer" aria-label={'Abrir anúncio de '+(v.variation_name||v.name)} className="ndb-cp-product-link"><Icon name="link" size={15}/></a>}
                        </div>)}</div>:<p className="ndb-cp-empty">Nenhuma variação com vendas identificadas para o período.</p>}
                        {num(t?.variation_count)>rows(t?.products).length&&<p className="ndb-cp-foot">Exibindo {rows(t?.products).length} de {fmt(t?.variation_count)} SKUs com vendas. Ordenado por unidades.</p>}
                      </>}
                    </div>
                  </td></tr>}
                </React.Fragment>;
              })}
            </DetailTable>
          </>:<p className="ndb-cp-empty">Sem categorias com vendas.</p>}
        </Section>
      </div>
      <div className="ndb-cp-visual-grid">
        <Section title={'Comparação mensal '+(selectedCollection?'da coleção':'da categoria')} subtitle={selectedCollection||picked?.name||''} aside={<div className="ndb-cp-legend"><span><i className="is-base"/>{baseYear}</span><span><i className="is-cur"/>{year}</span></div>}>
          <MonthlyBars points={months} selected={currentMonth} onSelect={chooseMonth} year={year} baseYear={baseYear}/>
        </Section>
        <Section title="Tabela mensal" subtitle={'Clique no mês para detalhar semanas · '+(selectedCollection||picked?.name||'')} >
          <DetailTable heads={['Mês',String(baseYear),String(year),'Diferença','Variação','Categoria líder','Coleção líder']}>
            {months.filter(m=>m.month<=(asOfMonth||1)).map(m=><tr key={m.month} className={currentMonth===m.month?'is-selected':''} onClick={()=>chooseMonth(m.month)}>
              <td><button type="button" className="ndb-cp-month-button" onClick={e=>{e.stopPropagation();chooseMonth(m.month)}}>{SHORT[m.month-1]}</button></td>
              <td>{fmt(m.base)}</td><td>{m.cur==null?'—':fmt(m.cur)}</td><td className={color(num(m.cur)-num(m.base))}>{m.cur==null?'—':delta(num(m.cur)-num(m.base))}</td>
              <td>{m.cur==null?'—':<PeriodTag cur={m.cur} base={m.base}/>}</td>
              <td>{m.catLeader}</td><td>{m.collectionLeader}</td>
            </tr>)}
          </DetailTable>
        </Section>
        <Section title={'Sazonalidade da '+(selectedCollection?'coleção':'categoria')} subtitle={(selectedCollection||picked?.name||'')+' · '+baseYear+' × '+year} aside={<div className="ndb-cp-legend"><span><i className="is-base"/>{baseYear}</span><span><i className="is-cur"/>{year}</span></div>}>
          <Seasonality points={months} onSelect={chooseMonth} selected={currentMonth} year={year} baseYear={baseYear}/>
          <p className="ndb-cp-foot">Meses futuros do ano atual não são tratados como zero. Clique em um mês para investigar.</p>
        </Section>
        <Section title="Comparação semanal" subtitle={MONTHS[currentMonth-1]+' · '+(selectedCollection||picked?.name||'')} aside={<div className="ndb-cp-month-arrows"><button type="button" disabled={currentMonth<=1} onClick={()=>chooseMonth(currentMonth-1)} aria-label="Mês anterior">‹</button><b>{SHORT[currentMonth-1]} {year}</b><button type="button" disabled={currentMonth>=asOfMonth} onClick={()=>chooseMonth(currentMonth+1)} aria-label="Próximo mês">›</button></div>}>
          <DetailTable heads={['Semana',String(baseYear),String(year),'Diferença','Variação','Coleção líder','']}>
            {weeks.map(w=><tr key={w.week} className={selectedWeek===w.week?'is-selected':''} onClick={()=>setSelectedWeek(selectedWeek===w.week?null:w.week)}>
              <td><button type="button" className="ndb-cp-week-button" onClick={e=>{e.stopPropagation();setSelectedWeek(selectedWeek===w.week?null:w.week)}}>{String(w.start).padStart(2,'0')}–{String(w.end).padStart(2,'0')}{w.partial?'*':''}</button></td>
              <td>{fmt(w.base)}</td><td><b>{fmt(w.cur)}</b></td><td className={color(w.cur-w.base)}>{delta(w.cur-w.base)}</td><td><PeriodTag cur={w.cur} base={w.base}/></td><td>{w.leaderCollection}</td><td className="ndb-cp-arrow">›</td>
            </tr>)}
          </DetailTable>
          {selectedWeek&&<div className="ndb-cp-week-selected">Semana {selectedWeek} selecionada: os produtos abaixo mostram somente essa semana. <button type="button" onClick={()=>setSelectedWeek(null)}>Limpar</button></div>}
          <p className="ndb-cp-foot">Semanas: 1–7, 8–14, 15–21, 22–28, 29–fim. * Semana parcial. As vendas são comparadas com a mesma faixa do ano anterior.</p>
        </Section>
      </div>
      <section id="ndb-cp-products"><Section title="Produtos e itens do período" subtitle={(selectedCollection||picked?.name||'')+' · '+MONTHS[currentMonth-1]+(selectedWeek?' · semana '+selectedWeek:'')+' · '+year+' × '+baseYear} aside={<span className="ndb-cp-chip">Fotos reais do catálogo · até 8 SKUs</span>} className="ndb-cp-products-panel">
        {temporal.loading?<p className="ndb-cp-loading">Carregando produtos e miniaturas…</p>:temporal.error?<div className="ndb-cp-error">{temporal.error}</div>:
          <div className="ndb-cp-products">
            {rows(t?.products).map(r=><div className="ndb-cp-product" key={r.sku}>
              <Thumb src={r.image} alt={r.name} size="large"/>
              <div className="ndb-cp-product-info"><b>{r.name||r.sku}</b><small>SKU: {r.sku}</small><span>{baseYear}: {fmt(r.base)} · {year}: <strong>{fmt(r.cur)}</strong> · <em className={color(num(r.cur)-num(r.base))}>{delta(num(r.cur)-num(r.base))} un.</em></span></div>
              {validLink(r.url)?<a href={r.url} target="_blank" rel="noopener noreferrer" className="ndb-cp-product-link" aria-label={'Abrir anúncio de '+r.name}><Icon name="link" size={16}/>Anúncio</a>:<span className="ndb-cp-no-link">Sem link</span>}
            </div>)}
            {!rows(t?.products).length&&<p className="ndb-cp-empty">Nenhum SKU com vendas identificadas nesse recorte.</p>}
          </div>}
        <p className="ndb-cp-foot">Ranking por unidades registradas; a ausência de vendas não comprova anúncio inativo. Miniaturas só aparecem quando há imagem cadastrada.</p>
      </Section></section>
    </>}
  </div>;
}
