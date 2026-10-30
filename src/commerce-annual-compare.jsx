import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {maskMoney} from './commerce-privacy.js';
import {growth,pctText} from './commerce-annual-compare-helpers.js';
import {Dropdown} from './commerce-dashboard.jsx';
import './commerce-annual-compare.css';
import GuidedAnnualCompare from './commerce-annual-guided.jsx';

// Dados e exibição de Categorias continuam aqui; somente a Comparação Anual legada foi removida.
const num=v=>Number(v||0).toLocaleString('pt-BR');
const money=v=>maskMoney(Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
const MONTHS=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const PLATFORMS=[['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre antigo'],['ML_NOVO','Mercado Livre novo'],['TODAS','Todas']];
const PLATFORM_LIST={SHOPEE:['SHOPEE'],ML_ANTIGO:['ML_ANTIGO'],ML_NOVO:['ML_NOVO'],TODAS:['SHOPEE','ML_ANTIGO','ML_NOVO']};
const MIN_UNITS=30;
const monthText=m=>{const [y,mm]=String(m||'').split('-');return mm?MONTHS[Number(mm)-1]+'/'+String(y).slice(2):'—';};

export function Delta({cur,base,small=false}){
  const c=Number(cur||0),b=Number(base||0);
  if(b===0&&c>0)return <span className={'ndb-ac-new'+(small?' is-sm':'')}>novo</span>;
  if(b===0&&c===0)return <span className="ndb-ac-mut">—</span>;
  const p=growth(c,b);
  const few=b<MIN_UNITS&&c<MIN_UNITS;
  return <span className={'ndb-ac-pill '+(p>=0?'up':'dn')+(small?' is-sm':'')+(few?' is-few':'')} title={few?'Poucas unidades nos dois anos: o percentual oscila muito.':undefined}>{p>=0?'▲':'▼'} {pctText(p)}</span>;
}

export function useAnnualCompare({platform,gran,year=null,base=null,refresh=0}){
  const [state,setState]=useState({loading:true,error:'',data:null});
  useEffect(()=>{
    const controller=new AbortController();
    setState(s=>({...s,loading:true,error:''}));
    fetchCommercialManager('/api/admin/commerce/sales-compare/annual?platform='+encodeURIComponent(platform)+'&gran='+gran+(year?'&year='+Number(year)+'&base='+Number(base||year-1):''),{signal:controller.signal})
      .then(data=>setState({loading:false,error:'',data}))
      .catch(e=>{if(!controller.signal.aborted)setState({loading:false,error:e?.message||'Não foi possível carregar o comparativo.',data:null});});
    return()=>controller.abort();
  },[platform,gran,year,base,refresh]);
  return state;
}

export function useAnnualMonth({platform,month,year=null,base=null,refresh=0}){
  const [state,setState]=useState({loading:true,error:'',data:null});
  useEffect(()=>{
    const controller=new AbortController();
    setState(s=>({...s,loading:true,error:''}));
    fetchCommercialManager('/api/admin/commerce/sales-compare/annual-month?platform='+encodeURIComponent(platform)+(month?'&month='+month:'')+(year?'&year='+Number(year)+'&base='+Number(base||year-1):''),{signal:controller.signal})
      .then(data=>setState({loading:false,error:'',data}))
      .catch(e=>{if(!controller.signal.aborted)setState({loading:false,error:e?.message||'Não foi possível carregar os dados do mês.',data:null});});
    return()=>controller.abort();
  },[platform,month,year,base,refresh]);
  return state;
}

export function AnnualFilters({filters,setFilters,data}){
  const units=(p,y)=>Number((data?.coverage||[]).find(c=>c.platform===p&&Number(c.year)===Number(y))?.units||0);
  const blockedFor=id=>{
    if(!data)return null;
    const list=PLATFORM_LIST[id]||[];
    return list.some(p=>units(p,data.base_year)<=0)?'Sem vendas de '+data.base_year+' importadas: não dá para comparar':null;
  };
  const options=PLATFORMS.map(([id,l])=>[id,l,blockedFor(id)]);
  const selectedBlocked=Boolean(options.find(o=>o[0]===filters.platform)?.[2]);
  useEffect(()=>{if(selectedBlocked)setFilters(prev=>({...prev,platform:'SHOPEE'}));},[selectedBlocked]);
  return <div className="ndb-ac-filters">
    <Dropdown label="Plataforma" value={filters.platform} options={options} onChange={v=>setFilters(prev=>({...prev,platform:v}))}/>
    <span className="ndb-ac-chip">Ano <b>{data?data.year:'—'}</b> contra <b>{data?data.base_year:'—'}</b></span>
    {data&&<span className="ndb-ac-asof">Dados até {String(data.as_of).split('-').reverse().join('/')}</span>}
  </div>;
}

function SkuList({title,items,empty}){
  return <div className="ndb-ac-blk"><h4>{title}</h4>
    {items.length===0?<p className="ndb-ac-mut ndb-ac-none">{empty}</p>:items.map(i=>
      <div className="ndb-ac-sku" key={i.sku}><div><span title={i.name||i.sku}>{i.name||i.sku}</span><small>{i.sku}</small></div>
        <span className="num ndb-ac-mut">{num(i.base)} → <b>{num(i.cur)}</b></span><Delta cur={i.cur} base={i.base} small/></div>)}
  </div>;
}

function SubDetail({sub,data,colSpan}){
  const pc=Number(sub.cur)>0?Number(sub.cur_rev)/Number(sub.cur):0,pb=Number(sub.base)>0?Number(sub.base_rev)/Number(sub.base):0;
  return <tr className="ndb-ac-detail"><td colSpan={colSpan}><div className="ndb-ac-dgrid">
    <div className="ndb-ac-blk"><h4>Resumo</h4>
      <div className="ndb-ac-kv2"><span>Melhor mês</span><b>{sub.best_month?monthText(sub.best_month)+' · '+num(sub.best_month_units)+' un.':'—'}</b></div>
      <div className="ndb-ac-kv2"><span>Preço médio {data.base_year}</span><b>{pb?money(pb):'—'}</b></div>
      <div className="ndb-ac-kv2"><span>Preço médio {data.year}</span><b>{pc?money(pc):'—'}{pb&&pc?<em className={pc>=pb?'g':'r'}> {pctText(growth(pc,pb))}</em>:null}</b></div>
    </div>
    <SkuList title="Mais cresceram" items={sub.up||[]} empty="Nenhum produto cresceu."/>
    <SkuList title="Mais caíram" items={sub.down||[]} empty="Nenhum produto caiu."/>
  </div></td></tr>;
}

export function CategoriesTable({data}){
  const [openCat,setOpenCat]=useState({});
  const [openSub,setOpenSub]=useState({});
  const cats=data?.categories||[];
  const maxAbs=useMemo(()=>Math.max(20,...cats.flatMap(c=>[c,...(c.subs||[])]).map(r=>Math.abs(growth(r.cur,r.base)??0))),[cats]);
  const unclassified=cats.find(c=>c.name==='Sem categoria');
  const Bar=({r})=>{const g=growth(r.cur,r.base);if(g==null)return null;return <div className="ndb-ac-bt"><i style={{width:Math.min(100,Math.abs(g)/maxAbs*100)+'%',background:g>=0?'#1b9a55':'#d9534f'}}/></div>;};
  const row=(r,kind,key,open,toggle,hasKids)=><tr key={key} className={'ndb-ac-r-'+kind+(open?' is-open':'')} onClick={hasKids?toggle:undefined} tabIndex={hasKids?0:undefined} onKeyDown={hasKids?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}}:undefined} aria-expanded={hasKids?open:undefined}>
    <td>{kind==='sub'&&<span className="ndb-ac-ind"/>}{hasKids&&<span className="ndb-ac-chev" aria-hidden="true">{open?'▾':'▸'}</span>}{r.name}</td>
    <td className="num ndb-ac-mut">{Number(r.base)?num(r.base):'—'}</td><td className="num"><b>{num(r.cur)}</b></td>
    <td><Delta cur={r.cur} base={r.base}/></td><td className="ndb-ac-bc"><Bar r={r}/></td>
    <td className="num"><Delta cur={r.cur28} base={r.base28} small/></td></tr>;
  return <section className="ndb-ac-card ndb-ac-cats" aria-label="Categorias e subcategorias">
    <h3>Categorias e subcategorias <small>clique para abrir</small></h3>
    <p className="ndb-ac-sub">Unidades de 01/01 até {String(data.as_of).split('-').reverse().slice(0,2).join('/')} de cada ano. “Últimos 28 dias” compara o mesmo intervalo de 28 dias nos dois anos.</p>
    {unclassified&&Number(unclassified.cur)+Number(unclassified.base)>0&&<p className="ndb-warn ndb-ac-warn" role="note"><b>{num(Number(unclassified.cur)+Number(unclassified.base))} unidades de SKUs ainda sem categoria.</b> Elas aparecem na linha “Sem categoria”. Quando entrar um SKU novo que não segue nenhum prefixo conhecido, ele cai aqui até ser classificado.</p>}
    <div className="ndb-ac-scroll"><table className="ndb-ac-table ndb-ac-cattable"><thead><tr><th>Categoria</th><th className="num">{data.base_year}</th><th className="num">{data.year}</th><th>Crescimento</th><th/><th className="num">Últimos 28 dias</th></tr></thead>
      <tbody>{cats.map(c=>{const co=!!openCat[c.name];return <React.Fragment key={c.name}>
        {row(c,'cat','c'+c.name,co,()=>setOpenCat(o=>({...o,[c.name]:!o[c.name]})),(c.subs||[]).length>0)}
        {co&&(c.subs||[]).map(s=>{const sk=c.name+'|'+s.name,so=!!openSub[sk];return <React.Fragment key={sk}>
          {row(s,'sub','s'+sk,so,()=>setOpenSub(o=>({...o,[sk]:!o[sk]})),true)}
          {so&&<SubDetail sub={s} data={data} colSpan={6}/>}</React.Fragment>;})}
      </React.Fragment>;})}
      </tbody></table></div>
    <p className="ndb-ac-note">Subcategoria que não existia no ano anterior aparece como “novo”. Percentuais com menos de {MIN_UNITS} unidades nos dois anos ficam em cinza porque oscilam muito. Coleções (como “Jardim de Afetos”) entram como um nível a mais quando forem cadastradas.</p>
  </section>;
}

export default function CommerceAnnualCompare({view='comparison',filters,setFilters,actions=null,refresh=0}) {
  const {loading,error,data}=useAnnualCompare({
    platform:filters.platform,
    gran:view==='categories'?(filters.gran||'month'):'month',
    year:filters.year||null,
    base:filters.base||null,
    refresh
  });
  const asOfMonth=Number((data?.as_of||'').slice(5,7))||0;
  const defaultMonth=asOfMonth>1?asOfMonth-1:(asOfMonth?1:'');
  const {data:monthData}=useAnnualMonth({
    platform:filters.platform,
    month:filters.month||(view==='categories'?'':defaultMonth),
    year:filters.year||null,
    base:filters.base||null,
    refresh
  });
  const fresh=Boolean(data&&data.platform===filters.platform&&
    (!filters.year||Number(data.year)===Number(filters.year)));
  return <div className="ndb-ac-root">
    {error&&<p className="ndb-error" role="alert">{error}</p>}
    {loading&&!fresh&&<p className="ndb-ac-mut ndb-ac-loading" role="status">Carregando comparativo…</p>}
    {fresh&&(view==='categories'
      ?<><AnnualFilters filters={filters} setFilters={setFilters} data={data}/><CategoriesTable data={data}/></>
      :<GuidedAnnualCompare data={data} monthData={monthData} filters={filters} setFilters={setFilters} refresh={refresh}/>)}
  </div>;
}
