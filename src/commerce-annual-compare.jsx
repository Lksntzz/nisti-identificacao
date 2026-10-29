import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {maskMoney} from './commerce-privacy.js';
import {growth,pctText,indexOf,weekHighlights,productLabel,share,newKind,projectionRange} from './commerce-annual-compare-helpers.js';
import {listingUrl,Dropdown} from './commerce-dashboard.jsx';
import './commerce-annual-compare.css';
import GuidedAnnualCompare from './commerce-annual-guided.jsx';

const num=v=>Number(v||0).toLocaleString('pt-BR');
const moneyRaw=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const money=v=>maskMoney(moneyRaw(v));
const MONTHS=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const PLATFORMS=[['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre antigo'],['ML_NOVO','Mercado Livre novo'],['TODAS','Todas']];
const PLATFORM_LIST={SHOPEE:['SHOPEE'],ML_ANTIGO:['ML_ANTIGO'],ML_NOVO:['ML_NOVO'],TODAS:['SHOPEE','ML_ANTIGO','ML_NOVO']};
const PLATFORM_NAME={SHOPEE:'Shopee',ML_ANTIGO:'Mercado Livre antigo',ML_NOVO:'Mercado Livre novo'};
const MIN_UNITS=30;

// Etiqueta ao lado das unidades: "novo" só quando o produto nunca vendeu no ano base inteiro.
function NewTag({row,base}){
  const k=newKind(row);
  if(k==='new')return <em className="ndb-ac-newtag" title={'Nenhuma venda em '+base+' inteiro'}>novo</em>;
  if(k==='old')return <em className="ndb-ac-newtag is-old" title={'Sem venda neste período de '+base+', mas vendeu em outros meses de '+base}>já vendia</em>;
  return null;
}

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

const MONTH_FULL=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const WEEK_LABEL={1:'Dias 1–7',2:'Dias 8–14',3:'Dias 15–21',4:'Dias 22–28',5:'Dia 29 em diante'};

function Index({cur,base}){
  const i=indexOf(cur,base);
  if(i==null)return <span className="ndb-ac-mut">—</span>;
  return <span className={'ndb-ac-idx '+(i>=100?'up':'dn')} title="100 = igual ao ano passado">{i}</span>;
}

function missingBase(data,platform){
  if(!data)return [];
  const list=PLATFORM_LIST[platform]||[];
  const cov=data.coverage||[];
  const units=(p,y)=>Number(cov.find(c=>c.platform===p&&c.year===y)?.units||0);
  return list.filter(p=>units(p,data.year)>0&&units(p,data.base_year)===0).map(p=>PLATFORM_NAME[p]);
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

function Kpi({label,value,delta,sub,info,onOpen}){
  return <button type="button" className="ndb-ac-kpi is-click" onClick={onOpen} aria-haspopup="dialog"><small>{label}</small><strong>{value}</strong>
    {delta}{sub&&<span className="ndb-ac-kpi-sub">{sub}</span>}{info&&<span className="ndb-ac-kpi-sub">{info}</span>}<span className="ndb-ac-kpi-more">Ver detalhes ›</span></button>;
}

export function AnnualKpis({data,onOpen=()=>{}}){
  const k=data?.kpi;if(!k)return null;
  const priceCur=Number(k.cur)>0?Number(k.cur_rev)/Number(k.cur):0,priceBase=Number(k.base)>0?Number(k.base_rev)/Number(k.base):0;
  return <div className="ndb-ac-kpis">
    <Kpi onOpen={()=>onOpen('units')} label="Unidades no ano" value={num(k.cur)} delta={<Delta cur={k.cur} base={k.base}/>} sub={data.base_year+': '+num(k.base)}/>
    <Kpi onOpen={()=>onOpen('l28')} label="Últimos 28 dias" value={num(k.cur28)} delta={<Delta cur={k.cur28} base={k.base28}/>} sub={'contra os mesmos 28 dias de '+data.base_year+' ('+num(k.base28)+')'}/>
    <Kpi onOpen={()=>onOpen('proj')} label={'Projeção de '+data.year} value={k.projection==null?'—':num(k.projection)}
      delta={k.projection==null?null:<Delta cur={k.projection} base={k.base_full}/>}
      sub={'estimativa pelo ritmo dos últimos 28 dias · '+data.base_year+' fechou em '+num(k.base_full)}/>
    <Kpi onOpen={()=>onOpen('price')} label="Preço médio" value={priceCur?money(priceCur):'—'} delta={priceBase?<Delta cur={priceCur} base={priceBase}/>:null} sub={priceBase?data.base_year+': '+money(priceBase):null}/>
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


export function KpiModal({kind,data,monthData,filters,onClose}){
  const needGran=kind==='l28'?'week':'month';
  const {loading,data:g}=useAnnualCompare({platform:filters.platform,gran:needGran,year:filters.year,base:filters.base});
  useEffect(()=>{
    const esc=e=>{if(e.key==='Escape')onClose();};
    document.addEventListener('keydown',esc);return()=>document.removeEventListener('keydown',esc);
  },[onClose]);
  const k=data.kpi,y=data.year,b=data.base_year;
  const titles={units:'Unidades no ano, mês a mês',l28:'Últimos 28 dias, semana a semana',proj:'Como a projeção de '+y+' foi calculada',price:'Preço médio por mês'};
  let body=null;
  if(kind==='units'){
    const rows=weekHighlights(monthData?.months||[]);
    body=<table className="ndb-ac-table"><thead><tr><th>Mês</th><th className="num">{b}</th><th className="num">{y}</th><th className="num">Índice</th><th className="num">Variação</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.month}><td><b>{MONTH_FULL[r.month-1]}</b></td><td className="num ndb-ac-mut">{num(r.base)}</td><td className="num"><b>{num(r.cur)}</b></td><td className="num"><Index cur={r.cur} base={r.base}/></td><td className="num"><Delta cur={r.cur} base={r.base} small/></td></tr>)}
        <tr className="ndb-ac-total"><td><b>Total</b></td><td className="num ndb-ac-mut">{num(k.base)}</td><td className="num"><b>{num(k.cur)}</b></td><td className="num"><Index cur={k.cur} base={k.base}/></td><td className="num"><Delta cur={k.cur} base={k.base} small/></td></tr></tbody></table>;
  }else if(kind==='l28'){
    const ws=(g?.periods||[]).slice(0,4);
    body=loading&&!g?<p className="ndb-ac-mut">Carregando…</p>:<><table className="ndb-ac-table"><thead><tr><th>Semana</th><th className="num">{b}</th><th className="num">{y}</th><th className="num">Índice</th><th className="num">Variação</th></tr></thead>
      <tbody>{ws.map(w=><tr key={w.key}><td><b>{w.label}</b></td><td className="num ndb-ac-mut">{num(w.base)}</td><td className="num"><b>{num(w.cur)}</b></td><td className="num"><Index cur={w.cur} base={w.base}/></td><td className="num"><Delta cur={w.cur} base={w.base} small/></td></tr>)}
        <tr className="ndb-ac-total"><td><b>28 dias</b></td><td className="num ndb-ac-mut">{num(k.base28)}</td><td className="num"><b>{num(k.cur28)}</b></td><td className="num"><Index cur={k.cur28} base={k.base28}/></td><td className="num"><Delta cur={k.cur28} base={k.base28} small/></td></tr></tbody></table>
      <p className="ndb-ac-note">Cada semana de {y} é comparada com a mesma semana 364 dias antes, para cair no mesmo dia da semana.</p></>;
  }else if(kind==='proj'){
    const pr=projectionRange(k,data.as_of);
    const rest=Number(k.base_full)-Number(k.base);
    const ratio=Number(k.base28)>0?Number(k.cur28)/Number(k.base28):null;
    const yr=Number(k.base)>0?Number(k.cur)/Number(k.base):null;
    const pct=v=>v==null?'—':v.toFixed(2).replace('.',',')+' ('+Math.round(v*100)+'%)';
    body=<><div className="ndb-ac-kv">
      <div><span>Vendido em {y} até agora</span><b>{num(k.cur)}</b></div>
      <div><span>{b}: o que faltava vender depois desta data</span><b>{num(rest)}</b></div>
      <div><span>Ritmo recente (últimos 28 dias {y} ÷ {b})</span><b>{pct(ratio)}</b></div>
      <div><span>Ritmo do ano até agora ({y} ÷ {b})</span><b>{pct(yr)}</b></div>
      <div><span>Método 1: faltante × ritmo recente</span><b>{pr?.recent==null?'—':num(pr.recent)}</b></div>
      <div><span>Método 2: faltante × ritmo do ano até agora</span><b>{pr?.year==null?'—':num(pr.year)}</b></div>
      <div><span>Método 3: ritmo diário dos últimos 28 dias mantido até 31/12</span><b>{pr?.pace==null?'—':num(pr.pace)}</b></div>
      <div><span>Faixa da projeção</span><b>{pr?num(pr.low)+' a '+num(pr.high):'—'}</b></div></div>
      <p className="ndb-warn ndb-ac-warn">Atenção: são três jeitos de estimar o resto do ano e nenhum é garantido. O método 1 é o mais pessimista quando {b} teve um pico recente (o ritmo dos últimos 28 dias fica baixo contra ele). Nov e dez costumam vender mais (11.11, Black Friday, Natal), então o método 3 tende a ficar baixo. Use como alerta, não como meta.</p></>;
  }else{
    const ps=g?.periods||[];
    body=loading&&!g?<p className="ndb-ac-mut">Carregando…</p>:<table className="ndb-ac-table"><thead><tr><th>Mês</th><th className="num">{b}</th><th className="num">{y}</th><th className="num">Variação</th></tr></thead>
      <tbody>{ps.map(p=>{const pc=Number(p.cur)>0?Number(p.cur_rev)/Number(p.cur):0,pb=Number(p.base)>0?Number(p.base_rev)/Number(p.base):0;return <tr key={p.key}><td><b>{p.label}</b></td><td className="num ndb-ac-mut">{pb?money(pb):'—'}</td><td className="num"><b>{pc?money(pc):'—'}</b></td><td className="num">{pc&&pb?<Delta cur={pc} base={pb} small/>:'—'}</td></tr>;})}</tbody></table>;
  }
  return <div className="ndb-ac-overlay" onClick={onClose}>
    <div className="ndb-ac-modal" role="dialog" aria-modal="true" aria-label={titles[kind]} onClick={e=>e.stopPropagation()}>
      <header><h3>{titles[kind]}</h3><button type="button" className="ndb-ac-x" aria-label="Fechar" onClick={onClose} autoFocus>×</button></header>
      <div className="ndb-ac-scroll">{body}</div>
    </div></div>;
}

export function WeeksCard({monthData,year,base,selected}){
  const all=weekHighlights(monthData?.months||[]);
  const rows=selected?all.filter(r=>r.month===Number(selected)):all;
  const ranked=all.filter(r=>r.index!=null);
  const worstM=ranked.reduce((a,r)=>(!a||r.index<a.index?r:a),null);
  const bestM=ranked.reduce((a,r)=>(!a||r.index>a.index?r:a),null);
  const fell=ranked.filter(r=>r.index<100).length;
  const cell=(r,n)=>{
    const w=r.weeks.find(x=>x.n===n);
    if(!w)return <td key={n} className="ndb-ac-wc is-empty">—</td>;
    const flags=[r.best&&r.best.n===n?'best':'',r.worst&&r.worst.n===n&&r.worst.index<100?'worst':'',r.top&&r.top.n===n&&r.top.index>=100?'top':''].filter(Boolean);
    const tip=WEEK_LABEL[n]+': '+base+' '+num(w.base)+' · '+year+' '+num(w.cur)+(w.partial?' (só '+w.days+' '+(w.days===1?'dia':'dias')+')':'')+(flags.includes('best')?' · semana que mais vendeu':'')+(flags.includes('worst')?' · semana que mais caiu':'')+(flags.includes('top')?' · semana que mais cresceu':'');
    const i=w.index;
    return <td key={n} className={'ndb-ac-wc '+(i==null?'':i>=100?'up':'dn')+(w.partial?' is-part':'')+(flags.length?' has-flag':'')} title={tip}>
      <b>{i==null?'—':i}</b><small>{num(w.cur)}</small>{flags.includes('best')&&<i className="ndb-ac-fl best" aria-label="mais vendeu">★</i>}{flags.includes('worst')&&<i className="ndb-ac-fl worst" aria-label="mais caiu">▼</i>}</td>;
  };
  return <section className="ndb-ac-card ndb-ac-weeks" aria-label="Semanas de cada mês">
    <div className="ndb-ac-wh"><h3>Semanas de cada mês</h3>
      <div className="ndb-ac-strip"><span>Mais forte <b>{bestM?MONTH_FULL[bestM.month-1]+' · '+bestM.index:'—'}</b></span><span>Mais fraco <b>{worstM?MONTH_FULL[worstM.month-1]+' · '+worstM.index:'—'}</b></span><span>Abaixo de {base} <b>{fell} de {all.length}</b></span></div></div>
    <p className="ndb-ac-sub">Cada célula é o índice da semana (100 = igual a {base}); o número pequeno são as unidades de {year}. ★ semana que mais vendeu · ▼ semana que mais caiu. Passe o mouse para ver {base} contra {year}. Semana cinza = poucos dias.</p>
    <div className="ndb-ac-scroll"><table className="ndb-ac-table ndb-ac-wtable"><thead><tr><th>Mês</th>{[1,2,3,4,5].map(n=><th key={n} className="num">{n===5?'29+':(n-1)*7+1+'–'+n*7}</th>)}<th className="num">Mês</th><th className="num">{base}</th><th className="num">{year}</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.month}><td><b>{MONTH_FULL[r.month-1].slice(0,3)}</b></td>{[1,2,3,4,5].map(n=>cell(r,n))}
        <td className={'ndb-ac-wc ndb-ac-wm '+(r.index==null?'':r.index>=100?'up':'dn')}><b>{r.index==null?'—':r.index}</b></td>
        <td className="num ndb-ac-mut">{num(r.base)}</td><td className="num"><b>{num(r.cur)}</b></td></tr>)}</tbody></table></div>
  </section>;
}

export function ProductLinks({links,platform='SHOPEE'}){
  // Só mostra anúncios da plataforma em análise e apenas o ícone; o nome vai no rótulo de acessibilidade.
  const want=l=>platform==='SHOPEE'?l.platform==='SHOPEE':String(platform).startsWith('ML')?l.platform!=='SHOPEE':true;
  const items=(links||[]).filter(want).map(l=>{const plat=l.platform==='SHOPEE'?'SHOPEE':'ML';const url=listingUrl(plat,l.id);return url?{url,label:plat==='SHOPEE'?'Shopee':'Mercado Livre'}:null;}).filter(Boolean);
  if(!items.length)return <span className="ndb-ac-mut" title="Nenhum anúncio ativo com este SKU">—</span>;
  return <span className="ndb-ac-links">{items.map(i=><a key={i.label} href={i.url} target="_blank" rel="noopener noreferrer" title={'Abrir anúncio na '+i.label} aria-label={'Abrir anúncio na '+i.label} onClick={e=>e.stopPropagation()}>
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>)}</span>;
}

export function PeriodProducts({platform,curFrom,curTo,baseFrom,baseTo,year,base,title}){
  const [state,setState]=useState({loading:true,error:'',data:null});
  useEffect(()=>{
    const c=new AbortController();
    setState({loading:true,error:'',data:null});
    fetchCommercialManager('/api/admin/commerce/sales-compare/annual-period-products?platform='+encodeURIComponent(platform)+'&cur_from='+curFrom+'&cur_to='+curTo+'&base_from='+baseFrom+'&base_to='+baseTo,{signal:c.signal})
      .then(data=>setState({loading:false,error:'',data}))
      .catch(e=>{if(!c.signal.aborted)setState({loading:false,error:e?.message||'Não foi possível carregar os produtos.',data:null});});
    return()=>c.abort();
  },[platform,curFrom,curTo,baseFrom,baseTo]);
  if(state.loading)return <p className="ndb-ac-mut" role="status">Carregando produtos…</p>;
  if(state.error)return <p className="ndb-error" role="alert">{state.error}</p>;
  const d=state.data,rows=d?.products||[];
  return <div className="ndb-ac-dayprod">
    <h4>{title}</h4>
    <div className="ndb-ac-scroll"><table className="ndb-ac-table"><thead><tr><th>Produto</th><th className="num">{base}</th><th className="num">{year}</th><th className="num">Dif.</th><th>Anúncio</th></tr></thead>
      <tbody>{rows.map(r=>{const L=productLabel(r.name,r.sku),df=Number(r.cur)-Number(r.base);return <tr key={r.sku}>
        <td><span className="ndb-ac-pn" title={r.name||r.sku}>{L.title}</span><small className="ndb-ac-mut">{L.collection?L.collection+' · ':''}{r.sku}</small></td>
        <td className="num ndb-ac-mut">{num(r.base)}</td><td className="num"><b>{num(r.cur)}</b><NewTag row={r} base={base}/></td>
        <td className={'num '+(df>=0?'g':'r')}>{df>=0?'+':'−'}{num(Math.abs(df))}</td><td><ProductLinks links={r.links} platform={platform}/></td></tr>;})}
        {rows.length===0&&<tr><td colSpan={5} className="ndb-ac-mut">Sem vendas registradas neste período.</td></tr>}
        {rows.length>0&&<tr className="ndb-ac-total"><td><b>Total</b></td><td className="num ndb-ac-mut">{num(d.total.base)}</td><td className="num"><b>{num(d.total.cur)}</b></td><td className={'num '+(d.total.cur>=d.total.base?'g':'r')}>{d.total.cur>=d.total.base?'+':'−'}{num(Math.abs(d.total.cur-d.total.base))}</td><td/></tr>}</tbody></table></div>
    {rows.length>=40&&<p className="ndb-ac-note">Mostrando os 40 produtos que mais venderam.</p>}
  </div>;
}

export function Champions({month,monthData,year,base,loading=false,platform='SHOPEE'}){
  const [tab,setTab]=useState('top');
  const tot=monthData?.month_total||{cur:0,base:0};
  const lists={top:(monthData?.top||[]).slice(0,10),up:(monthData?.up||[]).slice(0,10),down:(monthData?.down||[]).slice(0,10)};
  const rows=lists[tab];
  const useBase=tab==='down';
  const labels={top:'Campeões',up:'Mais cresceram',down:'Mais caíram'};
  const intro={top:'Os 10 que mais venderam em '+year+'.',up:'Os 10 que mais ganharam unidades contra '+base+'.',down:'Os 10 que mais perderam unidades contra '+base+'.'};
  const maxShare=Math.max(1,...rows.map(r=>share(useBase?r.base:r.cur,useBase?tot.base:tot.cur)||0));
  return <section className="ndb-ac-card ndb-ac-det ndb-ac-prod" aria-label="Produtos do mês">
    <div className="ndb-ac-wh"><h3>Produtos de {MONTH_FULL[month-1]}</h3>
      <div className="ndb-ac-seg" role="tablist" aria-label="Tipo de lista">
        {Object.keys(labels).map(k=><button type="button" role="tab" aria-selected={tab===k} key={k} className={tab===k?'is-on':''} onClick={()=>setTab(k)}>{labels[k]} <small>{lists[k].length}</small></button>)}
      </div></div>
    <p className="ndb-ac-sub">{intro[tab]} “Preço médio” = receita ÷ unidades vendidas no mês, sem frete (não é o preço de tabela do anúncio). “Novo” = nunca vendeu em {base} inteiro. “Já vendia” = sem venda neste mês de {base}, mas vendeu em outros meses.</p>
    <div className="ndb-ac-scroll"><table className="ndb-ac-table"><thead><tr><th>#</th><th>Produto</th><th className="num">{base}</th><th className="num">{year}</th><th className="num">Dif.</th><th className="num" title="Valor médio de venda por unidade (receita dos produtos ÷ unidades), sem frete">Preço médio {base} → {year}</th><th>Peso em {useBase?base:year}</th><th>Anúncio</th></tr></thead>
      <tbody>{rows.map((r,i)=>{const L=productLabel(r.name,r.sku),d=Number(r.cur)-Number(r.base),w=share(useBase?r.base:r.cur,useBase?tot.base:tot.cur);
        return <tr key={r.sku}><td className="ndb-ac-mut">{i+1}</td>
        <td><span className="ndb-ac-pn" title={r.name||r.sku}>{L.title}</span><small className="ndb-ac-mut">{L.collection?L.collection+' · ':''}{r.category?r.category+' · ':''}{r.sku}</small></td>
        <td className="num ndb-ac-mut">{num(r.base)}</td><td className="num"><b>{num(r.cur)}</b><NewTag row={r} base={base}/></td>
        <td className={'num '+(d>=0?'g':'r')}>{d>=0?'+':'−'}{num(Math.abs(d))}</td>
        <td className="num ndb-ac-pr">{(()=>{const pb=Number(r.base)>0&&Number(r.base_rev)>0?Number(r.base_rev)/Number(r.base):null,pc=Number(r.cur)>0&&Number(r.cur_rev)>0?Number(r.cur_rev)/Number(r.cur):null;
          return pc==null&&pb==null?'—':<><span className="ndb-ac-mut">{pb!=null?money(pb):'—'}</span> → <b>{pc!=null?money(pc):'—'}</b>{pb!=null&&pc!=null&&<Delta cur={pc} base={pb} small/>}</>;})()}</td>
        <td className="ndb-ac-wt">{w==null?'—':<><i style={{width:Math.max(3,w/maxShare*100)+'%'}}/><span>{w.toFixed(1).replace('.',',')}%</span></>}</td><td><ProductLinks links={r.links} platform={platform}/></td></tr>;})}
        {rows.length===0&&<tr><td colSpan={8} className="ndb-ac-mut">{loading?'Carregando produtos do mês…':'Nenhum produto nesta lista.'}</td></tr>}</tbody></table></div>
  </section>;
}

export default function CommerceAnnualCompare({view='comparison',filters,setFilters,actions=null,refresh=0}) {
  const {loading,error,data}=useAnnualCompare({
    platform:filters.platform,gran:view==='categories'?(filters.gran||'month'):'month',
    year:filters.year||null,base:filters.base||null,refresh
  });
  // Sem mês escolhido, a tela mostra o último mês completo: os produtos precisam ser buscados para esse mês.
  const asOfMonth=Number((data?.as_of||'').slice(5,7))||0;
  const defaultMonth=asOfMonth>1?asOfMonth-1:(asOfMonth?1:'');
  const {data:monthData}=useAnnualMonth({
    platform:filters.platform,month:filters.month||(view==='categories'?'':defaultMonth),year:filters.year||null,base:filters.base||null,refresh
  });
  const [modal,setModal]=useState(null);
  const title=view==='categories'?'Categorias':'Comparação anual';
  const lead=view==='categories'
    ?'Veja quais categorias e subcategorias puxam ou derrubam o resultado contra o ano anterior.'
    :'Veja se este ano estamos crescendo ou caindo contra o ano anterior, por mês, semana ou dia.';
  // A consulta conserva a última resposta enquanto atualiza: jamais mostrar dados
  // da plataforma/ano anterior com os filtros novos.
  const fresh=Boolean(data && data.platform===filters.platform &&
    (!filters.year || Number(data.year)===Number(filters.year)));
  return <div className="ndb-ac-root">
    {error&&<p className="ndb-error" role="alert">{error}</p>}
    {loading&&!fresh&&<p className="ndb-ac-mut ndb-ac-loading" role="status">Carregando comparativo…</p>}
    {fresh&&(view==='categories'
      ?<><AnnualFilters filters={filters} setFilters={setFilters} data={data}/><CategoriesTable data={data}/></>
      :<GuidedAnnualCompare data={data} monthData={monthData} filters={filters}
        setFilters={setFilters} refresh={refresh} onKpiOpen={setModal}
        WeeksCard={WeeksCard} Champions={Champions} PeriodSummary={PeriodSummary}
        PeriodDetails={PeriodDetails} useAnnualCompare={useAnnualCompare} PeriodProducts={PeriodProducts}/>)}
    {modal&&fresh&&<KpiModal kind={modal} data={data} monthData={monthData} filters={filters} onClose={()=>setModal(null)}/>}
  </div>;
}
