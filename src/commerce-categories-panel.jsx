import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {maskMoney} from './commerce-privacy.js';
import {Dropdown} from './commerce-dashboard.jsx';
import PeriodPicker from './commerce-period-picker.jsx';
import {useAnnualCompare,ProductLinks} from './commerce-annual-compare.jsx';
import {productLabel} from './commerce-annual-compare-helpers.js';
import {periodQuery,periodLabel,variation,categoryKpis,listCategories,unitPrice,SORTS,SHOWS} from './commerce-categories-helpers.js';
import './commerce-categories-panel.css';

const fmt=v=>Number(v||0).toLocaleString('pt-BR');
const signed=v=>(v>0?'+':v<0?'−':'')+fmt(Math.abs(v));
const money=v=>maskMoney(Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
const pct=v=>v==null?'':(v>0?'+':v<0?'−':'')+Math.abs(v).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
const share=(a,b)=>Number(b)>0?(Number(a)/Number(b)*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const PLATFORMS=[['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre antigo'],['ML_NOVO','Mercado Livre novo'],['TODAS','Todas as plataformas']];
const LOW=30;

// Busca JSON e só entrega a resposta da URL atual: nunca mostra dados de filtros anteriores.
function useJson(url,refresh=0){
  const [state,setState]=useState({url:'',loading:true,error:'',data:null});
  const [tries,setTries]=useState(0);
  useEffect(()=>{
    if(!url){setState({url:'',loading:false,error:'',data:null});return undefined;}
    const c=new AbortController();
    setState(s=>({...s,loading:true,error:''}));
    fetchCommercialManager(url,{signal:c.signal})
      .then(data=>{if(!c.signal.aborted)setState({url,loading:false,error:'',data});})
      .catch(e=>{if(!c.signal.aborted)setState({url,loading:false,error:e?.message||'Não foi possível carregar os dados.',data:null});});
    return()=>c.abort();
  },[url,refresh,tries]);
  const fresh=state.url===url;
  return {loading:state.loading||!fresh,error:fresh?state.error:'',data:fresh?state.data:null,retry:()=>setTries(n=>n+1)};
}

function Var({cur,base,neutral=false}){
  if(!(Number(base)>0))return <span className="ndb-cp-nobase">Sem base</span>;
  const p=variation(cur,base);
  const low=Number(base)<LOW&&Number(cur)<LOW;
  const cls=neutral||p===0?'is-neutral':p>0?'is-up':'is-down';
  return <span className={'ndb-cp-var '+cls+(low?' is-low':'')} title={low?'Poucas unidades nos dois anos: o percentual oscila muito.':undefined}>{p>0?'▲ ':p<0?'▼ ':''}{pct(p)}</span>;
}

function Kpi({label,value,hint,onClick,active}){
  const body=<><span className="ndb-cp-kpi-l">{label}</span><strong>{value}</strong><small>{hint}</small></>;
  return onClick?<button type="button" className={'ndb-cp-kpi'+(active?' is-active':'')} onClick={onClick} aria-pressed={active}>{body}</button>:<div className="ndb-cp-kpi">{body}</div>;
}

function Stat({label,value,sub,children}){
  return <div className="ndb-cp-stat"><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}{children}</div>;
}

function Failure({error,onRetry}){
  return <div className="ndb-cp-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Tentar novamente</button></div>;
}

function copySku(sku){try{navigator.clipboard?.writeText(sku);}catch(e){/* sem permissão: ignora */}}

function SkuRow({r,i,platform}){
  const diff=Number(r.cur)-Number(r.base);
  const pb=unitPrice(r.base_rev,r.base),pc=unitPrice(r.cur_rev,r.cur);
  return <li className="ndb-cp-sku">
    <span className="ndb-cp-rank">{i+1}º</span>
    <div className="ndb-cp-sku-main">
      <b title={r.name||r.sku}>{productLabel(r.name,r.sku).title}</b>
      <span><code>{r.sku}</code> <button type="button" className="ndb-cp-copy" onClick={()=>copySku(r.sku)} aria-label={'Copiar SKU '+r.sku}>copiar</button> <ProductLinks links={r.links} platform={platform}/></span>
      {pc!=null&&<small>Preço médio: {pb!=null?money(pb)+' → ':''}{money(pc)}</small>}
      {!(Number(r.base)>0)&&<small className="ndb-cp-warn">Sem venda no ano anterior: pode ser lançamento, troca de código ou falta de importação.</small>}
    </div>
    <div className="ndb-cp-sku-n"><span>{fmt(r.base)} → <b>{fmt(r.cur)}</b></span><em className={diff>=0?'is-up':'is-down'}>{signed(diff)} un.</em><Var cur={r.cur} base={r.base}/></div>
  </li>;
}

function SubDetail({cat,sub,query,year,baseYear,catRow,onBack,platform}){
  const [rank,setRank]=useState('up');
  const {loading,error,data,retry}=useJson('/api/admin/commerce/sales-compare/categories-sub?'+query+'&cat='+encodeURIComponent(cat)+'&sub='+encodeURIComponent(sub));
  useEffect(()=>setRank('up'),[cat,sub,query]);
  const s=catRow.subs.find(x=>x.name===sub)||{};
  const diff=Number(s.cur)-Number(s.base);
  const pc=unitPrice(s.cur_rev,s.cur),pb=unitPrice(s.base_rev,s.base);
  const bm=data?.best_month?.month?MONTHS[Number(data.best_month.month.slice(5,7))-1]+'/'+data.best_month.month.slice(2,4):null;
  const list=data?(rank==='up'?data.up:data.down)||[]:[];
  return <div className="ndb-cp-sub">
    <button type="button" className="ndb-cp-back" onClick={onBack}>← Voltar às subcategorias</button>
    <h4>{sub}<small>{cat}</small></h4>
    <div className="ndb-cp-grid2">
      <Stat label="Unidades" value={fmt(s.cur)} sub={baseYear+': '+fmt(s.base)+' · '+signed(diff)}/>
      <Stat label="Variação" value={Number(s.base)>0?pct(variation(s.cur,s.base)):'Sem base'} sub={Number(s.base)>0?'contra '+baseYear:'sem vendas em '+baseYear}/>
      <Stat label="Participação na categoria" value={share(s.cur,catRow.cur)} sub={'de '+fmt(catRow.cur)+' un.'}/>
      <Stat label="Últimos 28 dias" value={fmt(s.c28)} sub={baseYear+': '+fmt(s.b28)}><Var cur={s.c28} base={s.b28}/></Stat>
    </div>
    <dl className="ndb-cp-rows">
      <div><dt>Melhor mês</dt><dd>{loading?'…':bm?bm+' · '+fmt(data.best_month.units)+' un.':'—'}</dd></div>
      <div><dt>Preço médio por unidade</dt><dd>{pc!=null?money(pc):'—'}<small>{baseYear}: {pb!=null?money(pb):'—'} {pb!=null&&pc!=null&&<Var cur={pc} base={pb} neutral/>}</small></dd></div>
      <div><dt>Receita de produtos</dt><dd>{Number(s.cur_rev)>0?money(s.cur_rev):'—'}<small>{baseYear}: {Number(s.base_rev)>0?money(s.base_rev):'—'} · sem frete</small></dd></div>
    </dl>
    <div className="ndb-cp-tabs" role="tablist" aria-label="Ranking de produtos">
      {[['up','Mais cresceram'],['down','Mais caíram']].map(([k,l])=><button key={k} type="button" role="tab" aria-selected={rank===k} className={rank===k?'is-active':''} onClick={()=>setRank(k)}>{l}</button>)}
    </div>
    {error?<Failure error={error} onRetry={retry}/>
      :loading?<p className="ndb-cp-mut" role="status">Carregando produtos…</p>
      :list.length?<ol className="ndb-cp-skus">{list.map((r,i)=><SkuRow key={r.sku} r={r} i={i} platform={platform}/>)}</ol>
      :<p className="ndb-cp-mut">{rank==='up'?'Nenhum SKU com crescimento no período.':'Nenhum SKU com queda no período.'}</p>}
    <p className="ndb-cp-foot">Ranking pela diferença em unidades ({year} − {baseYear}); o percentual é informativo. Com diferença igual, vale o maior volume atual.</p>
  </div>;
}

function CategoryDetail({row,total,baseYear,query,year,sub,setSub,platform}){
  const diff=Number(row.cur)-Number(row.base);
  const pc=unitPrice(row.cur_rev,row.cur),pb=unitPrice(row.base_rev,row.base);
  if(sub)return <SubDetail platform={platform} cat={row.name} sub={sub} query={query} year={year} baseYear={baseYear} catRow={row} onBack={()=>setSub(null)}/>;
  return <div className="ndb-cp-cat">
    <h4>{row.name}</h4>
    {row.name==='Sem categoria'&&<p className="ndb-cp-note" role="note">Unidades de SKUs que ainda não têm categoria no cadastro. A análise é só diagnóstica: nada é classificado ou alterado automaticamente.</p>}
    <div className="ndb-cp-grid2">
      <Stat label="Unidades" value={fmt(row.cur)} sub={baseYear+': '+fmt(row.base)+' · '+signed(diff)}/>
      <Stat label="Variação" value={Number(row.base)>0?pct(variation(row.cur,row.base)):'Sem base'} sub={Number(row.base)>0?'contra '+baseYear:'sem vendas em '+baseYear}/>
      <Stat label="Participação" value={share(row.cur,total.cur)} sub={'de '+fmt(total.cur)+' un. no total'}/>
      <Stat label="Últimos 28 dias" value={fmt(row.c28)} sub={baseYear+': '+fmt(row.b28)}><Var cur={row.c28} base={row.b28}/></Stat>
    </div>
    <dl className="ndb-cp-rows">
      <div><dt>Receita de produtos</dt><dd>{Number(row.cur_rev)>0?money(row.cur_rev):'—'}<small>{baseYear}: {Number(row.base_rev)>0?money(row.base_rev):'—'} · sem frete</small></dd></div>
      <div><dt>Preço médio por unidade</dt><dd>{pc!=null?money(pc):'—'}<small>{baseYear}: {pb!=null?money(pb):'—'}</small></dd></div>
    </dl>
    <h5>Subcategorias <small>escolha uma para ver os produtos</small></h5>
    <ul className="ndb-cp-subs">{row.subs.map(s=><li key={s.name}><button type="button" onClick={()=>setSub(s.name)}>
      <span className="ndb-cp-subname">{s.name}</span><span className="ndb-cp-n">{fmt(s.cur)}</span><span className="ndb-cp-mut">{share(s.cur,row.cur)}</span><Var cur={s.cur} base={s.base}/></button></li>)}</ul>
  </div>;
}

class DetailGuard extends React.Component{
  constructor(p){super(p);this.state={failed:false};}
  static getDerivedStateFromError(){return {failed:true};}
  componentDidUpdate(prev){if(this.state.failed&&prev.resetKey!==this.props.resetKey)this.setState({failed:false});}
  render(){return this.state.failed?<p className="ndb-cp-error" role="alert">Não foi possível mostrar este detalhe. Escolha outra categoria ou subcategoria.</p>:this.props.children;}
}

export default function CommerceCategoriesPanel({filters,setFilters,refresh=0}){
  const cover=useAnnualCompare({platform:'SHOPEE',gran:'month',year:filters.year||null,base:filters.base||null,refresh});
  const coverage=cover.data?.coverage||[];
  const year=cover.data?Number(cover.data.year):null,baseYear=year?year-1:null;
  const unitsOf=(p,y)=>Number(coverage.find(c=>c.platform===p&&Number(c.year)===Number(y))?.units||0);
  const needsBase=p=>unitsOf(p,baseYear)<=0;
  const NO_BASE='Sem vendas de '+baseYear+' importadas: não dá para comparar';
  const platformOptions=PLATFORMS.map(([id,l])=>[id,l,year&&(id==='TODAS'?['SHOPEE','ML_ANTIGO','ML_NOVO'].some(needsBase):needsBase(id))?NO_BASE:null]);
  const blocked=Boolean(platformOptions.find(o=>o[0]===filters.platform)?.[2]);
  useEffect(()=>{if(blocked)setFilters(p=>({...p,platform:'SHOPEE'}));},[blocked]);
  const query=year?periodQuery(filters,year):'';
  const {loading,error,data,retry}=useJson(query?'/api/admin/commerce/sales-compare/categories?'+query:'',refresh);
  const [search,setSearch]=useState('');
  const [show,setShow]=useState('all');
  const [sort,setSort]=useState('units');
  const [selCat,setSelCat]=useState(null);
  const [selSub,setSelSub]=useState(null);
  useEffect(()=>{setSelCat(null);setSelSub(null);},[query]);
  const rows=useMemo(()=>listCategories(data?.categories,{search,show,sort}),[data,search,show,sort]);
  const kpi=useMemo(()=>categoryKpis(data),[data]);
  const current=data?(rows.find(r=>r.name===selCat)||rows[0]||null):null;
  const maxUnits=useMemo(()=>Math.max(1,...(data?.categories||[]).flatMap(c=>[Number(c.cur),Number(c.base)])),[data]);
  const pick=name=>{setSelCat(name);setSelSub(null);};
  const days=Number(filters.days)||0;
  const month=Number(filters.month)||0;
  const available=year?MONTHS.map((_,i)=>year+'-'+String(i+1).padStart(2,'0')).filter((_,i)=>i<=Number((cover.data?.as_of||'').slice(5,7))-1):[];
  const updateFilters=patch=>setFilters(prev=>({...prev,...patch}));
  const total=data?.total||{cur:0,base:0};
  return <div className="ndb-cp">
    <header className="ndb-cp-head"><div><h2>Categorias</h2><p>Quais categorias puxam ou derrubam o resultado contra o ano anterior.</p></div>
      {data&&<span className="ndb-cp-asof">Dados até {String(data.as_of).split('-').reverse().join('/')}</span>}</header>
    <div className="ndb-cp-filters">
      <Dropdown label="Plataforma" value={filters.platform} options={platformOptions} onChange={v=>updateFilters({platform:v})}/>
      <Dropdown label="Comparação" value={String(year||'')} options={year?[[String(year),year+' × '+(year-1)]]:[['','…']]} onChange={()=>{}}/>
      <PeriodPicker days={days} month={month&&year?year+'-'+String(month).padStart(2,'0'):''} periods={[7,30,60,90]} allowAll allLabel="Acumulado do ano"
        available={available} onDays={v=>updateFilters({days:v,month:''})} onMonth={key=>updateFilters({days:0,month:String(Number(key.slice(5,7)))})}/>
      <Dropdown label="Exibir" value={show} options={Object.entries(SHOWS)} onChange={setShow}/>
      <Dropdown label="Ordenar" value={sort} options={Object.entries(SORTS)} onChange={setSort}/>
      <label className="ndb-cp-search"><span className="ndb-cp-sr">Pesquisar categoria</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pesquisar categoria"/></label>
    </div>
    {data&&<p className="ndb-cp-period" role="note">{periodLabel(data)} · mesmas datas do calendário nos dois anos.</p>}
    {cover.error&&<p className="ndb-cp-error" role="alert">{cover.error}</p>}
    {error&&<Failure error={error} onRetry={retry}/>}
    {!error&&loading&&<p className="ndb-cp-mut" role="status">Carregando categorias…</p>}
    {data&&!error&&<>
      <div className="ndb-cp-kpis">
        <Kpi label="Unidades vendidas" value={fmt(kpi.units)} hint={Number(total.base)>0?baseYear+': '+fmt(total.base)+' · '+pct(variation(total.cur,total.base)):baseYear+': sem base'}/>
        <Kpi label="Categorias em crescimento" value={fmt(kpi.up)} hint="com base no ano anterior" onClick={()=>setShow(show==='up'?'all':'up')} active={show==='up'}/>
        <Kpi label="Categorias em queda" value={fmt(kpi.down)} hint="com base no ano anterior" onClick={()=>setShow(show==='down'?'all':'down')} active={show==='down'}/>
        <Kpi label="Sem categoria" value={fmt(kpi.noneUnits)+' un.'} hint={kpi.units>0?share(kpi.noneUnits,kpi.units)+' das unidades':'—'} onClick={()=>setShow(show==='none'?'all':'none')} active={show==='none'}/>
      </div>
      <div className="ndb-cp-body">
        <section className="ndb-cp-list" aria-label="Lista de categorias">
          <div className="ndb-cp-lh" aria-hidden="true"><span>Categoria</span><span>{baseYear} × {year}</span><span className="r">Part.</span><span className="r">Dif.</span><span className="r">Var.</span><span className="r">28 dias</span></div>
          {rows.length===0?<div className="ndb-cp-empty"><p>Nenhuma categoria com estes filtros.</p><button type="button" onClick={()=>{setSearch('');setShow('all');}}>Limpar filtros</button></div>
          :<ul>{rows.map(r=>{const d=Number(r.cur)-Number(r.base);const on=current&&current.name===r.name;return <li key={r.name}>
            <button type="button" className={'ndb-cp-row'+(on?' is-selected':'')} aria-pressed={on} onClick={()=>pick(r.name)}>
              <span className="ndb-cp-name">{r.name}</span>
              <span className="ndb-cp-bars"><i className="b" style={{width:Number(r.base)/maxUnits*100+'%'}}/><i className="c" style={{width:Number(r.cur)/maxUnits*100+'%'}}/><em>{fmt(r.base)} → <b>{fmt(r.cur)}</b></em></span>
              <span className="r ndb-cp-mut">{share(r.cur,total.cur)}</span>
              <span className={'r ndb-cp-d '+(d>0?'is-up':d<0?'is-down':'')}>{signed(d)}</span>
              <span className="r"><Var cur={r.cur} base={r.base}/></span>
              <span className="r"><Var cur={r.c28} base={r.b28}/></span>
            </button></li>;})}</ul>}
          <p className="ndb-cp-foot">Barra cinza: {baseYear}; azul: {year}. A barra mostra volume, não crescimento. “28 dias” é a janela dos últimos 28 dias do período, contra as mesmas datas do ano anterior. Percentuais em cinza têm menos de {LOW} unidades nos dois anos.</p>
        </section>
        <aside className="ndb-cp-detail" aria-label="Investigação da categoria" aria-live="polite">
          {current?<DetailGuard resetKey={current.name+'|'+selSub}><CategoryDetail platform={filters.platform} key={current.name} row={current} total={total} baseYear={baseYear} year={year} query={query} sub={selSub} setSub={setSelSub}/></DetailGuard>
            :<p className="ndb-cp-mut">Selecione uma categoria para investigar.</p>}
        </aside>
      </div>
    </>}
  </div>;
}
