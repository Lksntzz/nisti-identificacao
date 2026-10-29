import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {maskMoney} from './commerce-privacy.js';
import {growth,pctText} from './commerce-annual-compare-helpers.js';
import './commerce-annual-compare.css';

const num=v=>Number(v||0).toLocaleString('pt-BR');
const moneyRaw=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const money=v=>maskMoney(moneyRaw(v));
const MONTHS=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const PLATFORMS=[['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre antigo'],['ML_NOVO','Mercado Livre novo'],['TODAS','Todas']];
const PLATFORM_LIST={SHOPEE:['SHOPEE'],ML_ANTIGO:['ML_ANTIGO'],ML_NOVO:['ML_NOVO'],TODAS:['SHOPEE','ML_ANTIGO','ML_NOVO']};
const PLATFORM_NAME={SHOPEE:'Shopee',ML_ANTIGO:'Mercado Livre antigo',ML_NOVO:'Mercado Livre novo'};
const MIN_UNITS=30;

const monthText=m=>{const [y,mm]=String(m||'').split('-');return mm?MONTHS[Number(mm)-1]+'/'+String(y).slice(2):'—';};

// Selo de variação. Sem base (produto novo) ou com poucas unidades não mostra percentual enganoso.
export function Delta({cur,base,small=false}){
  const c=Number(cur||0),b=Number(base||0);
  if(b===0&&c>0)return <span className={'ndb-ac-new'+(small?' is-sm':'')}>novo</span>;
  if(b===0&&c===0)return <span className="ndb-ac-mut">—</span>;
  const p=growth(c,b);
  const few=b<MIN_UNITS&&c<MIN_UNITS;
  return <span className={'ndb-ac-pill '+(p>=0?'up':'dn')+(small?' is-sm':'')+(few?' is-few':'')} title={few?'Poucas unidades nos dois anos: o percentual oscila muito.':undefined}>{p>=0?'▲':'▼'} {pctText(p)}</span>;
}

export function useAnnualCompare({platform,gran,refresh=0}){
  const [state,setState]=useState({loading:true,error:'',data:null});
  useEffect(()=>{
    const controller=new AbortController();
    setState(s=>({...s,loading:true,error:''}));
    fetchCommercialManager('/api/admin/commerce/sales-compare/annual?platform='+platform+'&gran='+gran,{signal:controller.signal})
      .then(data=>setState({loading:false,error:'',data}))
      .catch(e=>{if(!controller.signal.aborted)setState({loading:false,error:e?.message||'Não foi possível carregar o comparativo.',data:null});});
    return()=>controller.abort();
  },[platform,gran,refresh]);
  return state;
}

function missingBase(data,platform){
  if(!data)return [];
  const list=PLATFORM_LIST[platform]||[];
  const cov=data.coverage||[];
  const units=(p,y)=>Number(cov.find(c=>c.platform===p&&c.year===y)?.units||0);
  return list.filter(p=>units(p,data.year)>0&&units(p,data.base_year)===0).map(p=>PLATFORM_NAME[p]);
}

export function AnnualFilters({filters,setFilters,data}){
  const missing=missingBase(data,filters.platform);
  return <>
    <div className="ndb-ac-filters">
      <div className="ndb-ac-seg" role="group" aria-label="Comparar por">
        {[['day','Dia'],['week','Semana'],['month','Mês']].map(([k,l])=>
          <button type="button" key={k} className={filters.gran===k?'is-on':''} aria-pressed={filters.gran===k} onClick={()=>setFilters({...filters,gran:k})}>{l}</button>)}
      </div>
      <span className="ndb-ac-chip">Ano <b>{data?data.year:'—'}</b> contra <b>{data?data.base_year:'—'}</b></span>
      <label className="ndb-ac-chip ndb-ac-select"><span>Plataforma</span>
        <select value={filters.platform} onChange={e=>setFilters({...filters,platform:e.target.value})}>
          {PLATFORMS.map(([k,l])=><option key={k} value={k}>{l}</option>)}
        </select></label>
      {data&&<span className="ndb-ac-asof">Dados até {String(data.as_of).split('-').reverse().join('/')}</span>}
    </div>
    {missing.length>0&&<p className="ndb-warn ndb-ac-warn" role="note">
      <b>{missing.join(' e ')} de {data.base_year} ainda não foi importado.</b> Sem esse ano, {missing.length>1?'essas plataformas aparecem':'essa plataforma aparece'} como crescimento de 100% e o total fica errado. Compare só a Shopee até importar.
    </p>}
  </>;
}

function Kpi({label,value,delta,sub,info}){
  return <div className="ndb-ac-kpi"><small>{label}</small><strong>{value}</strong>
    {delta}{sub&&<span className="ndb-ac-kpi-sub">{sub}</span>}{info&&<span className="ndb-ac-kpi-sub">{info}</span>}</div>;
}

export function AnnualKpis({data}){
  const k=data?.kpi;if(!k)return null;
  const priceCur=Number(k.cur)>0?Number(k.cur_rev)/Number(k.cur):0,priceBase=Number(k.base)>0?Number(k.base_rev)/Number(k.base):0;
  return <div className="ndb-ac-kpis">
    <Kpi label="Unidades no ano" value={num(k.cur)} delta={<Delta cur={k.cur} base={k.base}/>} sub={data.base_year+': '+num(k.base)}/>
    <Kpi label="Últimos 28 dias" value={num(k.cur28)} delta={<Delta cur={k.cur28} base={k.base28}/>} sub={'contra os mesmos 28 dias de '+data.base_year+' ('+num(k.base28)+')'}/>
    <Kpi label={'Projeção de '+data.year} value={k.projection==null?'—':num(k.projection)}
      delta={k.projection==null?null:<Delta cur={k.projection} base={k.base_full}/>}
      sub={'estimativa pelo ritmo dos últimos 28 dias · '+data.base_year+' fechou em '+num(k.base_full)}/>
    <Kpi label="Preço médio" value={priceCur?money(priceCur):'—'} delta={priceBase?<Delta cur={priceCur} base={priceBase}/>:null} sub={priceBase?data.base_year+': '+money(priceBase):null}/>
  </div>;
}

function PeriodBars({periods,year,base}){
  const rows=periods;
  const max=Math.max(1,...rows.map(p=>Math.max(Number(p.cur),Number(p.base))));
  return <div className="ndb-ac-bars" role="img" aria-label={'Unidades por período, '+year+' contra '+base}>
    {rows.map(p=><div className="ndb-ac-bar-col" key={p.key} title={p.label+': '+year+' '+num(p.cur)+' · '+base+' '+num(p.base)}>
      <div className="ndb-ac-bar-pair"><i className="o" style={{height:Math.max(2,Number(p.base)/max*100)+'%'}}/><i className="n" style={{height:Math.max(2,Number(p.cur)/max*100)+'%'}}/></div>
      <small>{p.label.length>6?p.label.slice(0,5):p.label}</small></div>)}
  </div>;
}

export function PeriodSummary({data}){
  const periods=data?.periods||[];
  const k=data?.kpi||{};
  const best=periods.reduce((m,p)=>(!m||Number(p.cur)>Number(m.cur)?p:m),null);
  const withBase=periods.filter(p=>Number(p.base)>=MIN_UNITS&&Number(p.cur)>=0);
  const top=withBase.reduce((m,p)=>{const g=growth(p.cur,p.base);return (!m||g>m.g)?{p,g}:m;},null);
  const up=periods.filter(p=>Number(p.cur)>Number(p.base)).length,down=periods.filter(p=>Number(p.cur)<Number(p.base)).length;
  const unit={month:'meses',week:'semanas',day:'dias'}[data?.gran]||'períodos';
  return <section className="ndb-ac-card ndb-ac-sum" aria-label="Resumo">
    <h3>Resumo</h3>
    <p className="ndb-ac-sub">{data.gran==='month'?'Janeiro a '+(MONTHS[new Date(data.as_of+'T12:00:00').getMonth()]||'')+' (até '+String(data.as_of).split('-').reverse().slice(0,2).join('/')+')':data.gran==='week'?'Últimas 12 semanas (7 dias cada, mesmo dia da semana do ano anterior)':'Últimos 30 dias (mesmo dia da semana do ano anterior)'}</p>
    <small className="ndb-ac-lbl">Unidades em {data.year}</small>
    <div className="ndb-ac-big">{num(k.cur)}</div>
    <div className="ndb-ac-row"><Delta cur={k.cur} base={k.base}/><span className="ndb-ac-mut">contra {num(k.base)} em {data.base_year}</span></div>
    <PeriodBars periods={periods} year={data.year} base={data.base_year}/>
    <div className="ndb-ac-legend"><span><i className="o"/>{data.base_year}</span><span><i className="n"/>{data.year}</span></div>
    <div className="ndb-ac-kv">
      <div><span>Melhor período de {data.year}</span><b>{best?best.label+' · '+num(best.cur)+' un.':'—'}</b></div>
      <div><span>Maior crescimento</span><b>{top?top.p.label+' · '+pctText(top.g):'—'}</b></div>
      <div><span>{unit[0].toUpperCase()+unit.slice(1)} acima de {data.base_year}</span><b>{up} de {periods.length}</b></div>
      <div><span>{unit[0].toUpperCase()+unit.slice(1)} abaixo de {data.base_year}</span><b>{down}</b></div>
    </div>
  </section>;
}

export function PeriodDetails({data}){
  const periods=data?.periods||[];
  const k=data?.kpi||{};
  const head={month:'Mês',week:'Semana',day:'Dia'}[data?.gran]||'Período';
  return <section className="ndb-ac-card ndb-ac-det" aria-label="Detalhes">
    <h3>Detalhes</h3>
    <p className="ndb-ac-sub">{data.gran==='month'?'Cada mês de '+data.year+' contra o mesmo mês de '+data.base_year+' (o mês atual vai só até o último dia importado)':'Cada período contra o mesmo período 364 dias antes, para comparar o mesmo dia da semana'}</p>
    <div className="ndb-ac-scroll"><table className="ndb-ac-table"><thead><tr><th>{head}</th><th className="num">{data.base_year}</th><th className="num">{data.year}</th><th className="num">Diferença</th><th className="num">Variação</th></tr></thead>
      <tbody>{periods.map(p=>{const d=Number(p.cur)-Number(p.base);return <tr key={p.key}>
        <td><b>{p.label}</b></td><td className="num ndb-ac-mut">{num(p.base)}</td><td className="num"><b>{num(p.cur)}</b></td>
        <td className={'num '+(d>=0?'g':'r')}>{d>=0?'+':'−'}{num(Math.abs(d))}</td><td className="num"><Delta cur={p.cur} base={p.base} small/></td></tr>;})}
        {data.gran==='month'&&<tr className="ndb-ac-total"><td><b>Total</b></td><td className="num ndb-ac-mut">{num(k.base)}</td><td className="num"><b>{num(k.cur)}</b></td>
          <td className={'num '+(Number(k.cur)>=Number(k.base)?'g':'r')}>{Number(k.cur)>=Number(k.base)?'+':'−'}{num(Math.abs(Number(k.cur)-Number(k.base)))}</td><td className="num"><Delta cur={k.cur} base={k.base} small/></td></tr>}
      </tbody></table></div>
  </section>;
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

export default function CommerceAnnualCompare({view='comparison',filters,setFilters,actions=null,refresh=0}){
  const {loading,error,data}=useAnnualCompare({platform:filters.platform,gran:filters.gran,refresh});
  const title=view==='categories'?'Categorias':'Comparação anual';
  const lead=view==='categories'?'Veja quais categorias e subcategorias puxam ou derrubam o resultado contra o ano anterior.':'Veja se este ano estamos crescendo ou caindo contra o ano anterior, por mês, semana ou dia.';
  return <div className="ndb-ac-root">
    <header className="ndb-head"><div className="ndb-head-title"><span className="ndb-logo" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg></span>
      <div><h2>{title}</h2><p>{lead}</p></div></div>{actions&&<div className="ndb-head-filters">{actions}</div>}</header>
    <AnnualFilters filters={filters} setFilters={setFilters} data={data}/>
    {error&&<p className="ndb-error" role="alert">{error}</p>}
    {loading&&!data&&<p className="ndb-ac-mut ndb-ac-loading">Carregando comparativo…</p>}
    {data&&<div className={loading?'ndb-ac-body is-loading':'ndb-ac-body'}>
      {view==='categories'?<CategoriesTable data={data}/>:<>
        <AnnualKpis data={data}/>
        <div className="ndb-ac-g2"><PeriodSummary data={data}/><PeriodDetails data={data}/></div></>}
    </div>}
  </div>;
}
