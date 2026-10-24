import React,{useEffect,useState} from 'react';
import CommercialIcon from './vendor/CommercialIcon.jsx';
import './commerce-evolution-integrated.css';

// Evolução de vendas por anúncio — layout v2 (foco: quem vende e quem não vende).
// Mesma API e mesmas regras de honestidade: zero só quando os relatórios
// importados confirmam; caso contrário, "dados pendentes".
const API='/api/admin/commerce/listings/manager';
const PAGE=12,WINDOWS=[30,60,90];
const PLATFORMS=[['TODAS','Todas as plataformas'],['SHOPEE','Shopee'],
  ['MERCADO_LIVRE','Mercado Livre'],['ML_ANTIGO','Mercado Livre Antigo'],
  ['ML_NOVO','Mercado Livre Novo']];
const number=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));
const pct=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(n);
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';
const platformName=s=>s==='SHOPEE'?'Shopee':s==='ML_NOVO'?'Mercado Livre Novo':
  s==='ML_ANTIGO'?'Mercado Livre Antigo':s==='MERCADO_LIVRE'?'Mercado Livre':s||'Marketplace';
const known=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n));

const observedVariationCounts=(ad,days)=>{
  const variations=Array.isArray(ad?.variations)?ad.variations:[];
  return variations.reduce((acc,v)=>{
    const identified=v?.['identified_'+days];
    if(!v.match_verified||!known(identified)
      ||Number(identified)===0&&Number(ad?.['unlinked_'+days])>0)acc.pending++;
    else if(Number(identified)>0)acc.sold++;
    else acc.withoutSales++;
    return acc;
  },{sold:0,withoutSales:0,pending:0});
};
const adUnits=(ad,n)=>known(ad?.['units_'+n])?Number(ad['units_'+n])
  :ad?.period_end&&known(ad?.['identified_'+n])?Number(ad['identified_'+n]):null;
const adTrend=ad=>{
  if(!known(ad?.current_window_units)||!known(ad?.previous_window_units))return null;
  const current=Number(ad.current_window_units),previous=Number(ad.previous_window_units);
  return {current,previous,delta:current-previous,
    percent:previous>0?Math.round((current-previous)*1000/previous)/10:null};
};
// Estado do anúncio no período: SOLD (vendeu), ZERO (0 confirmado), PENDING (sem comprovação).
const adState=(ad,days)=>{
  const units=adUnits(ad,days);
  if(units===null||!ad?.period_end)return 'PENDING';
  return units>0?'SOLD':'ZERO';
};
const variationState=(v,d,ad)=>{
  if(!v.match_verified)return 'LINK';
  const identified=v?.['identified_'+d];
  if(!known(identified))return 'UNKNOWN';
  if(Number(identified)===0&&Number(ad?.['unlinked_'+d])>0)return 'UNKNOWN';
  return Number(identified)>0?'SOLD':'ZERO';
};
const VARIATION_LABEL={SOLD:'Vendendo',ZERO:'Sem vendas',LINK:'SKU pendente',UNKNOWN:'Sem comprovação'};
const variationHint=(v,d,ad,st)=>{
  if(st==='LINK')return v.match_issue==='MISSING_SKU'?'SKU ausente no catálogo':
    v.match_issue==='DUPLICATE_SKU'?'SKU duplicado entre variações':'Vínculo de SKU não aprovado';
  if(st==='UNKNOWN')return Number(ad?.['unlinked_'+d])>0
    ?'Há vendas do anúncio sem SKU atribuído':'Faltam relatórios para confirmar zero';
  return '';
};

function WeeklyChart({listingId}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{
    const ctrl=new AbortController();setLoading(true);setError('');
    fetch(API+'/'+encodeURIComponent(listingId)+'/evolution-weekly',
      {credentials:'same-origin',cache:'no-store',signal:ctrl.signal})
      .then(async r=>{const x=await r.json().catch(()=>({}));
        if(!r.ok)throw Error(x.error||'Gráfico indisponível');return x;})
      .then(x=>{if(!ctrl.signal.aborted)setData(x);})
      .catch(e=>{if(!ctrl.signal.aborted)setError(e.message);})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[listingId]);
  if(loading)return <p className="nev-muted" role="status">Carregando vendas por semana…</p>;
  if(error)return <p className="nev-muted" role="alert">{error}</p>;
  const points=Array.isArray(data?.points)?data.points:[];
  const total=points.reduce((t,p)=>t+Math.max(0,Number(p.identified_units)||0),0);
  if(!points.length||total===0)return <p className="nev-muted">Nenhuma venda semanal identificada nos últimos 90 dias.</p>;
  const max=Math.max(1,...points.map(p=>Number(p.identified_units)||0));
  return <div className="nev-weekly" role="img"
    aria-label={'Vendas por semana nos últimos 90 dias até '+date(data.end_date)}>
    {points.map(p=>{const v=Math.max(0,Number(p.identified_units)||0);
      return <div className="nev-week" key={p.week_start}
        title={date(p.week_start)+' a '+date(p.week_end)+': '+number(v)+' un.'}>
        <span className="nev-week-value">{v>0?number(v):''}</span>
        <span className="nev-week-bar" style={{height:Math.max(v>0?6:2,(v/max)*72)+'px'}}
          data-empty={v===0?'1':undefined}/>
        <small>{date(p.week_start).slice(0,5)}</small>
      </div>;})}
  </div>;
}

function VariationList({ad,days}){
  const [onlyProblems,setOnlyProblems]=useState(false);
  const all=Array.isArray(ad.variations)?ad.variations:[];
  const rows=all.map(v=>({v,st:variationState(v,days,ad)}))
    .filter(r=>!onlyProblems||r.st!=='SOLD')
    .sort((a,b)=>({ZERO:0,LINK:1,UNKNOWN:2,SOLD:3}[a.st]-({ZERO:0,LINK:1,UNKNOWN:2,SOLD:3}[b.st])));
  if(!all.length)return <p className="nev-muted">Este anúncio não tem variações com SKU vinculado.
    As vendas aparecem pelo ID do anúncio.</p>;
  return <div className="nev-variations">
    <div className="nev-variations-head">
      <strong>Variações · {days} dias</strong>
      <label><input type="checkbox" checked={onlyProblems}
        onChange={e=>setOnlyProblems(e.target.checked)}/> Só as que não estão vendendo</label>
    </div>
    <ul>{rows.map(({v,st})=>{
      const units=v?.['identified_'+days];
      const hint=variationHint(v,days,ad,st);
      return <li key={v.id||v.sku} className={'nev-var '+st.toLowerCase()}>
        <span className="nev-var-name"><strong>{v.name||v.sku||'Variação'}</strong>
          <small>{v.sku||'SKU não informado'}</small></span>
        <span className="nev-var-units">{st==='SOLD'||st==='ZERO'?number(units)+' un.':'—'}</span>
        <span className="nev-var-state"><b>{VARIATION_LABEL[st]}</b>{hint&&<small>{hint}</small>}</span>
      </li>;
    })}</ul>
    {rows.length===0&&<p className="nev-muted">Todas as variações estão vendendo neste período.</p>}
  </div>;
}

function AdDetails({ad,days}){
  const [showWeekly,setShowWeekly]=useState(false);
  return <div className="nev-details">
    <div className="nev-windows">{WINDOWS.map(n=>{const u=adUnits(ad,n);
      return <div key={n} className={n===days?'current':''}>
        <small>{n} dias</small>
        <strong>{u===null?'—':number(u)+' un.'}</strong>
        <span>{ad.period_end&&known(ad['revenue_'+n])?money(ad['revenue_'+n]):'—'}</span>
      </div>;})}</div>
    {Number(ad['unlinked_'+days])>0&&<p className="nev-note" role="note">
      {number(ad['unlinked_'+days])} unidade(s) vendida(s) pelo ID do anúncio sem SKU atribuído.
      Entram no total do anúncio, mas não em nenhuma variação.</p>}
    <VariationList ad={ad} days={days}/>
    <div className="nev-details-foot">
      <button type="button" className="nev-link-btn" aria-expanded={showWeekly}
        onClick={()=>setShowWeekly(o=>!o)}>
        <CommercialIcon name="chart-no-axes-column-increasing" size={14}/>
        {showWeekly?'Ocultar vendas por semana':'Ver vendas por semana'}
      </button>
      <span>Dados até {date(ad.period_end)}</span>
      {ad.url&&<a href={ad.url} target="_blank" rel="noopener noreferrer">Abrir no marketplace ↗</a>}
    </div>
    {showWeekly&&<WeeklyChart listingId={ad.listing_id}/>}
  </div>;
}

function AdRow({ad,days}){
  const [open,setOpen]=useState(false);
  const state=adState(ad,days);
  const units=adUnits(ad,days);
  const counts=observedVariationCounts(ad,days);
  const totalVars=counts.sold+counts.withoutSales+counts.pending;
  const trend=['STABLE','RISING','FALLING'].includes(ad.situation)?adTrend(ad):null;
  return <article className={'nev-row '+state.toLowerCase()+(open?' open':'')}>
    <button type="button" className="nev-row-main" onClick={()=>setOpen(o=>!o)}
      aria-expanded={open} aria-label={'Detalhes do anúncio '+ad.external_listing_id}>
      <span className="nev-row-title"><strong>{ad.title||'Anúncio sem título'}</strong>
        <small>{platformName(ad.source)} · ID {ad.external_listing_id}</small></span>
      <span className="nev-row-sales">
        {state==='SOLD'&&<><strong>{number(units)}</strong><small>un. em {days} dias</small></>}
        {state==='ZERO'&&<><strong>0</strong><small>sem vendas em {days} dias</small></>}
        {state==='PENDING'&&<><strong>—</strong><small>dados pendentes</small></>}
      </span>
      <span className="nev-row-trend">{trend
        ?<span className={trend.delta>0?'up':trend.delta<0?'down':'flat'}>
          {trend.delta>0?'▲':trend.delta<0?'▼':'■'} {trend.delta>0?'+':''}{number(trend.delta)}
          {trend.percent!==null&&<small> ({trend.percent>0?'+':''}{pct(trend.percent)}%)</small>}
        </span>
        :<span className="none">—</span>}</span>
      <span className="nev-row-vars">{totalVars>0?<>
        <span className="nev-bar" aria-hidden="true">
          <i className="sold" style={{flex:counts.sold}}/>
          <i className="zero" style={{flex:counts.withoutSales}}/>
          <i className="pending" style={{flex:counts.pending}}/>
        </span>
        <small>{number(counts.sold)} de {number(totalVars)} vendendo
          {counts.withoutSales>0&&<b> · {number(counts.withoutSales)} parada(s)</b>}</small>
      </>:<small>Sem variações vinculadas</small>}</span>
      <span className="nev-chevron" aria-hidden="true"><CommercialIcon name="chevron-right" size={16}/></span>
    </button>
    {open&&<AdDetails ad={ad} days={days}/>}
  </article>;
}

export default function CommerceEvolutionIntegrated({
  platform='TODAS',onPlatformChange=()=>{},initialDays=30,onPeriodChange=()=>{},
  status='ALL',onStatusChange=()=>{},revision=0,salesRevision=0
}){
  const selectedPlatform=PLATFORMS.some(([p])=>p===platform)?platform:'TODAS';
  const [days,setDays]=useState(WINDOWS.includes(initialDays)?initialDays:30);
  const [draft,setDraft]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0);
  const [report,setReport]=useState(null),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setSearch(draft.trim()),300);return ()=>clearTimeout(t);},[draft]);
  useEffect(()=>setOffset(0),[selectedPlatform,days,status,search]);
  useEffect(()=>{
    const ctrl=new AbortController(),params=new URLSearchParams({
      platform:selectedPlatform,days:String(days),status,limit:String(PAGE),offset:String(offset)
    });
    if(search)params.set('search',search);
    setLoading(true);setError('');setReport(null);
    fetch(API+'/evolution-ads?'+params,{credentials:'same-origin',cache:'no-store',signal:ctrl.signal})
      .then(async res=>{const body=await res.json().catch(()=>({}));
        if(!res.ok)throw Error(body.error||'Não foi possível consultar vendas.');return body;})
      .then(body=>{if(!ctrl.signal.aborted)setReport(body);})
      .catch(e=>{if(!ctrl.signal.aborted)setError(e.message);})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[selectedPlatform,days,status,search,offset,revision,salesRevision,retry]);
  const rows=Array.isArray(report?.items)?report.items:[],total=Number(report?.total||0);
  const kpis=report?.kpis||{},coverage=Array.isArray(report?.coverage)?report.coverage:[];
  const v=n=>report?number(n):'—';
  const tabs=[['ALL','Todos',kpis.total],['ZERO','Sem vendas ou paradas',kpis.zero],
    ['RISING','Crescendo',kpis.rising],['STABLE','Estáveis',kpis.stable]];
  const setPeriod=n=>{setDays(n);onPeriodChange(n);};
  return <section className="nev" aria-label="Evolução de vendas por anúncio">
    <div className="nev-toolbar">
      <label className="nev-field">Plataforma
        <select value={selectedPlatform} onChange={e=>onPlatformChange(e.target.value)}>
          {PLATFORMS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
      <div className="nev-field" role="group" aria-label="Período">Período
        <div className="nev-segmented">{WINDOWS.map(n=><button type="button" key={n}
          className={n===days?'active':''} aria-pressed={n===days}
          onClick={()=>setPeriod(n)}>{n} dias</button>)}</div>
      </div>
      <label className="nev-field nev-search">Pesquisar
        <input type="search" value={draft} maxLength={120}
          onChange={e=>setDraft(e.target.value)} placeholder="Nome, ID ou SKU…"/></label>
    </div>

    <div className="nev-overview">
      <div className="nev-big sold">
        <small>Com vendas em {days} dias</small>
        <strong>{v(kpis.with_sales)}</strong>
        <span>anúncios</span>
      </div>
      <button type="button" className={'nev-big zero'+(status==='ZERO'?' selected':'')}
        onClick={()=>onStatusChange(status==='ZERO'?'ALL':'ZERO')} aria-pressed={status==='ZERO'}>
        <small>Sem vendas em {days} dias</small>
        <strong>{v(kpis.no_sales_ads)}</strong>
        <span>anúncios{Number(kpis.selling_ads_with_unsold_variations)>0&&<>
          {' '}· + {number(kpis.selling_ads_with_unsold_variations)} com variações paradas</>}</span>
      </button>
      <div className="nev-big total">
        <small>Total no filtro</small>
        <strong>{v(kpis.total)}</strong>
        <span>{coverage.length?'dados até '+coverage.map(c=>platformName(c.source)+' '+date(c.end_date)).join(' · '):'anúncios ativos'}</span>
      </div>
    </div>

    <div className="nev-tabs" role="tablist" aria-label="Situação das vendas">
      {tabs.map(([id,label,count])=><button type="button" role="tab" key={id}
        aria-selected={status===id} className={status===id?'active':''}
        onClick={()=>onStatusChange(id)}>{label}<span>{v(count)}</span></button>)}
    </div>

    {loading&&<p className="nev-empty" role="status">Carregando anúncios…</p>}
    {error&&<p className="nev-empty" role="alert">{error}{' '}
      <button type="button" onClick={()=>setRetry(x=>x+1)}>Tentar novamente</button></p>}
    {!loading&&!error&&<>
      <div className="nev-list-head" aria-hidden="true">
        <span>Anúncio</span><span>Vendas · {days} dias</span><span>vs. período anterior</span>
        <span>Variações</span><span/>
      </div>
      {rows.length===0&&<p className="nev-empty">Nenhum anúncio neste filtro.</p>}
      <div className="nev-list">{rows.map(ad=><AdRow
        key={[selectedPlatform,days,status,search,offset,ad.listing_id].join(':')}
        ad={ad} days={days}/>)}</div>
      {total>PAGE&&<footer className="nev-pagination">
        <span>{number(offset+1)}–{number(Math.min(total,offset+rows.length))} de {number(total)}</span>
        <div><button type="button" disabled={!offset}
          onClick={()=>setOffset(n=>Math.max(0,n-PAGE))}>Anterior</button>
        <button type="button" disabled={offset+PAGE>=total}
          onClick={()=>setOffset(n=>n+PAGE)}>Próxima</button></div>
      </footer>}
    </>}

    <details className="nev-method">
      <summary>Como os números são calculados</summary>
      <ul>
        <li>Fonte: vendas importadas, anúncios ativos e vínculos verificados de SKU.
          Os totais de 30, 60 e 90 dias terminam na última data importada.</li>
        <li><b>Sem vendas</b> significa zero vendas encontradas nos relatórios disponíveis.
          Quando faltam relatórios, o anúncio aparece como <b>dados pendentes</b>, e não como zero.</li>
        <li><b>Crescendo</b>: alta de 20% e ao menos 2 unidades sobre o período anterior de mesma duração.
          <b> Estáveis</b>: vendas próximas ao período anterior. Só é calculado com cobertura completa nos dois períodos.</li>
        <li>Vendas pelo ID do anúncio sem SKU atribuído entram no total do anúncio, mas não em nenhuma variação.
          Estoque e tráfego por variação não são inferidos.</li>
      </ul>
    </details>
  </section>;
}
