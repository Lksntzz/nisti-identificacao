import React,{useEffect,useState} from 'react';
import CommercialIcon from './vendor/CommercialIcon.jsx';
import './commerce-evolution-integrated.css';

const API='/api/admin/commerce/listings/manager';
const PAGE=12,WINDOWS=[30,60,90];
const STATUS=[['ZERO','Sem vendas'],['STABLE','Estável'],['RISING','Crescimento']];
const PLATFORMS=[['TODAS','Todas as plataformas'],['SHOPEE','Shopee'],
  ['MERCADO_LIVRE','Mercado Livre'],['ML_ANTIGO','Mercado Livre Antigo'],
  ['ML_NOVO','Mercado Livre Novo']];
const number=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';
const platformName=s=>s==='SHOPEE'?'Shopee':s==='ML_NOVO'?'Mercado Livre Novo':
  s==='ML_ANTIGO'?'Mercado Livre Antigo':s||'Marketplace';
const known=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n));
const variationSales=(v,d)=>v?.['units_'+d];
const variationState=(v,d)=>{
  if(!v.match_verified)return 'LINK';
  const units=variationSales(v,d);
  if(!known(units))return 'UNKNOWN';
  if(Number(units)===0)return 'ZERO';
  return v['coverage_'+d]===true?'SOLD':'PARTIAL';
};
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
const adUnitsLabel=(ad,n)=>known(ad?.['units_'+n])
  ?number(ad['units_'+n])+' un.':
  ad?.period_end&&known(ad?.['identified_'+n])
    ?number(ad['identified_'+n])+' un.':'—';
const adRevenueLabel=(ad,n)=>ad?.period_end&&known(ad?.['revenue_'+n])
  ?money(ad['revenue_'+n]):'—';
const verifiedUnsoldVariations=(ad,d)=>{
  if(Number(ad?.['unlinked_'+d])>0)return [];
  return (Array.isArray(ad?.variations)?ad.variations:[])
    .filter(v=>v.match_verified&&known(v['identified_'+d])
      &&Number(v['identified_'+d])===0);
};
const variationStateForAd=(v,d,ad)=>{
  if(!v.match_verified)return 'LINK';
  const identified=v?.['identified_'+d];
  if(!known(identified))return 'UNKNOWN';
  if(Number(identified)===0&&Number(ad?.['unlinked_'+d])>0)return 'UNKNOWN';
  return Number(identified)>0?'SOLD':'ZERO';
};
const situationName=s=>({
  ZERO:'Sem vendas',STABLE:'Estável',RISING:'Crescimento',
  FALLING:'Revisar queda',INSUFFICIENT:'Dados pendentes'
})[s]||'Dados pendentes';

function Value({value,identified=null,coverage=true,observed=false}){
  return <span className="nei-value">{observed
    ?known(identified)?number(identified)+' un.':'—'
    :coverage&&known(value)?number(value)+' un.'
    :known(identified)?Number(identified)>0?'≥ '+number(identified)+' un.':'0 identificadas'
    :'—'}</span>;
}
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
  if(loading)return <p className="nei-chart-message" role="status">Carregando gráfico de vendas identificadas…</p>;
  if(error)return <p className="nei-chart-message" role="alert">{error}</p>;
  const points=Array.isArray(data?.points)?data.points:[];
  if(!points.length)return <p className="nei-chart-message">Não há dados datados suficientes para desenhar a evolução deste anúncio.</p>;
  const weeklyTotal=points.reduce((total,p)=>total+Math.max(0,Number(p.identified_units)||0),0);
  if(weeklyTotal===0)return <div className="nei-chart-empty" role="status">
    <strong>Nenhuma venda semanal identificada neste intervalo.</strong>
    <p>Sem registros datados não significa ausência de vendas quando a cobertura é incompleta.</p>
  </div>;
  const max=Math.max(1,...points.map(x=>Number(x.identified_units)||0));
  const ticks=max<=4?Array.from({length:max+1},(_,i)=>i):
    [...new Set([0,.25,.5,.75,1].map(part=>Math.round(max*part)))];
  const x=i=>38+i*(490/Math.max(1,points.length-1));
  const y=v=>155-(Math.max(0,Number(v)||0)/max)*124;
  const coords=points.map((p,i)=>[x(i),y(p.identified_units)]);
  const line=coords.map(([px,py],i)=>(i?'L':'M')+px.toFixed(1)+','+py.toFixed(1)).join(' ');
  const area=line+' L'+x(points.length-1)+',155 L38,155 Z';
  return <div className="nei-chart">
    <div className="nei-chart-header"><strong>Vendas identificadas por semana</strong>
      <span>Últimos 90 dias até {date(data.end_date)}</span></div>
    <svg viewBox="0 0 560 190" role="img" aria-label="Gráfico semanal de unidades identificadas nos últimos 90 dias">
      <defs><linearGradient id={'nei-chart-fill-'+listingId} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#2e72ea" stopOpacity=".24"/>
        <stop offset="100%" stopColor="#2e72ea" stopOpacity=".015"/>
      </linearGradient></defs>
      {ticks.map(tick=><g key={tick}>
        <line x1="38" y1={y(tick)} x2="530" y2={y(tick)} stroke="#e6edf7" strokeDasharray="4 4"/>
        <text x="30" y={y(tick)+4} textAnchor="end" fontSize="10" fill="#8091a9">
          {number(tick)}</text>
      </g>)}
      <path d={area} fill={'url(#nei-chart-fill-'+listingId+')'}/>
      <path d={line} fill="none" stroke="#2d6eeb" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round"/>
      {points.map((p,i)=><g key={p.week_start}>
        <circle cx={x(i)} cy={y(p.identified_units)} r="3.5"
          fill="#fff" stroke="#2d6eeb" strokeWidth="2"/>
        <title>{date(p.week_start)} a {date(p.week_end)}:
          {' '}{number(p.identified_units)} unidade(s) identificada(s)</title>
      </g>)}
      {[0,3,6,9,12].filter(i=>i<points.length).map(i=><text key={i}
        x={x(i)} y="177" textAnchor="middle" fontSize="10" fill="#8191a8">
        {date(points[i].week_start).slice(0,5)}</text>)}
    </svg>
    <p>O gráfico mostra vendas vinculadas aos SKUs identificados, não visitas.
      Sem cobertura completa, semanas sem registro não comprovam ausência de vendas.</p>
  </div>;
}
function Investigation({variation,days,ad}){
  const st=variationStateForAd(variation,days,ad);
  if(st==='LINK'){
    const why=variation.match_issue==='MISSING_SKU'?'SKU ausente no catálogo':
      variation.match_issue==='DUPLICATE_SKU'?'SKU duplicado entre variações':
      'Vínculo de SKU ainda não aprovado';
    return <div className="nei-reason"><strong>Identificação pendente · {why}</strong>
      <p>Corrija ou aprove o vínculo antes de concluir que esta variação não vendeu.</p></div>;
  }
  if(st==='UNKNOWN')return <div className="nei-reason">
    <strong>{Number(ad?.['unlinked_'+days])>0
      ?'Venda identificada no anúncio sem atribuição de SKU'
      :variation.match_verified&&known(variation['identified_'+days])
        &&Number(variation['identified_'+days])===0
        ?'Nenhuma venda identificada nesta variação'
        :'Período com cobertura incompleta'}</strong>
    <p>{Number(ad?.['unlinked_'+days])>0
      ?'Há vendas sem vínculo confiável com esta variação. Não é possível afirmar zero.'
      :'Os registros importados não mostram vendas desta variação, mas faltam dias para confirmar zero.'}</p>
  </div>;
  if(st==='ZERO'){
    const earlier=days===30&&known(variation.units_60)&&variation.units_60>0
      ?'Há vendas anteriores dentro da janela de 60 dias.':'';
    return <div className="nei-reason">
      <strong>0 vendas registradas em {days} dias</strong>
      <p>{earlier} {observedVariationCounts(ad,days).sold>0
        ?'Outras variações do anúncio tiveram vendas registradas.':''}
        {' '}A quantidade corresponde ao SKU nos relatórios importados.</p>
    </div>;
  }
  return null;
}
function VariationTable({ad,days,focusWithoutSales=false}){
  const [issuesOnly,setIssuesOnly]=useState(false);
  const all=Array.isArray(ad.variations)?ad.variations:[];
  const zeroSkuIds=new Set(verifiedUnsoldVariations(ad,days).map(v=>v.id));
  const shown=all.filter(v=>
    (!focusWithoutSales || zeroSkuIds.has(v.id)) &&
    (!issuesOnly||['ZERO','LINK','UNKNOWN','PARTIAL'].includes(variationStateForAd(v,days,ad))));
  return <div className="nei-variations">
    <div className="nei-subheading"><strong>Variações vinculadas ({number(ad.variation_count??all.length)})</strong>
      {!focusWithoutSales&&<label><input type="checkbox" checked={issuesOnly}
        onChange={e=>setIssuesOnly(e.target.checked)}/> Apenas sem vendas ou pendentes</label>}</div>
    <div className="nei-table-scroll"><table><thead><tr>
      <th>Variação / SKU</th>{WINDOWS.map(n=><th key={n}>Vendas {n} dias</th>)}
      <th>Situação</th>{!focusWithoutSales&&<th>Observações e possíveis motivos</th>}
    </tr></thead><tbody>{shown.map(v=>{
      const st=variationStateForAd(v,days,ad);
      return <tr key={v.id}>
        <td><strong>{v.name}</strong><small>{v.sku||'SKU não informado'}</small></td>
        {WINDOWS.map(n=><td key={n}><Value
          value={Number(ad['unlinked_'+n])>0&&Number(variationSales(v,n))===0
            ?null:variationSales(v,n)}
          identified={v.match_verified&&!(Number(ad['unlinked_'+n])>0
            &&Number(v['identified_'+n])===0)?v['identified_'+n]:null}
          coverage={v['coverage_'+n]===true} observed={true}/></td>)}
        <td><span className={'nei-pill '+(focusWithoutSales?'zero':st.toLowerCase())}>
          {focusWithoutSales?'0 vendas registradas':({
          ZERO:'0 vendas registradas',SOLD:'Com vendas',PARTIAL:'Venda identificada',
          LINK:'SKU pendente',
          UNKNOWN:Number(ad['unlinked_'+days])>0?'Vínculo pendente':
            v.match_verified&&known(v['identified_'+days])&&Number(v['identified_'+days])===0
            ?'Sem venda identificada':'Sem comprovação'
        })[st]}</span></td>
        {!focusWithoutSales&&<td><Investigation variation={v} days={days} ad={ad}/>
          {!['ZERO','LINK','UNKNOWN'].includes(st)
          &&<small>Venda identificada; acompanhar desempenho.</small>}</td>}
      </tr>;
    })}</tbody></table></div>
    {shown.length===0&&<p className="nei-empty">
      {focusWithoutSales?'Nenhum SKU com zero vendas registradas pôde ser identificado neste anúncio.':
        'Nenhuma variação com pendência identificada neste anúncio.'}</p>}
  </div>;
}
function VariationSummary({ad,days}){
  const counts=observedVariationCounts(ad,days);
  return <div className="nei-variation-summary" aria-label={'Resumo das variações nos últimos '+days+' dias'}>
    <strong>Variações · {days} dias</strong>
    <div className="nei-variation-stats">
      <span><b className="nei-stat-sold">{number(counts.sold)}</b><small>Com vendas identificadas</small></span>
      <span><b className="nei-stat-zero">{number(counts.withoutSales)}</b><small>Sem vendas identificadas</small></span>
      <span><b>{number(counts.pending)}</b><small>Vínculo ou dados pendentes</small></span>
    </div>
  </div>;
}
function Advertisement({ad,days,initialExpanded=false,focusWithoutSales=false}){
  const [expanded,setExpanded]=useState(initialExpanded);
  const [showWeekly,setShowWeekly]=useState(false);
  const badge=ad.situation||'INSUFFICIENT';
  const counts=observedVariationCounts(ad,days);
  const zeroVariations=focusWithoutSales?verifiedUnsoldVariations(ad,days):[];
  const noAdSales=focusWithoutSales&&known(ad?.['identified_'+days])
    &&Number(ad['identified_'+days])===0;
  const hasSales=ad.period_end&&Number(ad['identified_'+days])>0;
  const unitLabel=n=>adUnitsLabel(ad,n);
  return <article className={'nei-ad '+(expanded?'expanded':'')}>
    <button type="button" className="nei-ad-summary" onClick={()=>setExpanded(!expanded)}
      aria-expanded={expanded} aria-label={'Detalhes do anúncio '+ad.external_listing_id}>
      <span className="nei-ad-icon"><CommercialIcon name="notebook-tabs" size={19}/></span>
      <span className="nei-ad-main"><strong>{ad.title||'Anúncio sem título'}</strong>
        <small>{platformName(ad.source)} · ID: {ad.external_listing_id}</small>
        {focusWithoutSales&&<small className="nei-zero-observed">
          {noAdSales?'Anúncio com 0 vendas registradas':
            number(zeroVariations.length)+' variação(ões) com 0 vendas registradas'}
        </small>}</span>
      <span className="nei-ad-var-count">{Number(ad.variation_count)===0
        ?'Sem SKU vinculado':number(ad.variation_count)+' variações'}
        {Number(ad.sold_variations)>0&&<small className="nei-variations-sold">{number(ad.sold_variations)} com vendas</small>}
        {counts.withoutSales>0&&<small className="nei-variations-zero">
          {number(counts.withoutSales)} sem venda identificada
        </small>}
        {counts.pending>0&&<small className="nei-variations-pending">
          {number(counts.pending)} vínculo(s) pendentes
        </small>}
      </span>
      {WINDOWS.map(n=><span key={n} className="nei-ad-period">{unitLabel(n)}</span>)}
      <span className={'nei-pill '+(focusWithoutSales
        ?noAdSales?'zero':'zero-variation':badge.toLowerCase())}>
        {focusWithoutSales?noAdSales?'Sem vendas':'Variações sem vendas':
          hasSales?'Com vendas':
          ad.period_end&&Number(ad['identified_'+days])===0?'0 vendas registradas':
          situationName(badge)}
      </span>
      <span className={'nei-chevron '+(expanded?'turned':'')}>
        <span className="nei-details-label">{expanded?'Ocultar dados':'Ver dados'}</span>
        <CommercialIcon name="chevron-right" size={17}/>
      </span>
    </button>
    {focusWithoutSales&&zeroVariations.length>0&&<div className="nei-zero-sku-preview">
      <strong>Variações com 0 vendas registradas:</strong>
      {zeroVariations.slice(0,4).map(v=><span key={v.id||v.sku}>
        {v.name||v.sku} <small>{v.sku||'SKU não informado'}</small>
      </span>)}
      {zeroVariations.length>4&&<small>+{number(zeroVariations.length-4)} variações · Ver dados</small>}
    </div>}
    {expanded&&<div className="nei-ad-expanded">
      <div className="nei-ad-overview">
        <div className="nei-window-cards">{WINDOWS.map(n=><div className="nei-window-card" key={n}>
          <small>Vendas {n} dias</small>
          <strong>{unitLabel(n)}</strong>
          <span>{ad.period_end?'Unidades nos relatórios importados':'Sem relatório importado'}</span>
        </div>)}</div>
        <VariationSummary ad={ad} days={days}/>
      </div>
      <div className="nei-revenue-panel">
        <div><strong>Faturamento de produtos identificado</strong>
          <small>Valor dos itens vendidos por ID do anúncio, sem descontar taxas ou frete.</small></div>
        <div className="nei-revenue-values">{WINDOWS.map(n=><span key={n}>
          <small>{n} dias</small>
          <strong>{adRevenueLabel(ad,n)}</strong>
        </span>)}</div>
      </div>
      {Number(ad['unlinked_'+days])>0&&<p className="nei-unlinked-notice" role="note">
        <strong>{number(ad['unlinked_'+days])} unidade(s) identificada(s) pelo ID do anúncio</strong>
        {' '}sem vínculo confiável com uma variação. Estas vendas entram no total do anúncio,
        mas não são atribuídas a um SKU arbitrariamente.
      </p>}

      <VariationTable ad={ad} days={days} focusWithoutSales={focusWithoutSales}/>
      <div className="nei-weekly-section">
        <button type="button" className="nei-weekly-toggle" aria-expanded={showWeekly}
          onClick={()=>setShowWeekly(open=>!open)}>
          <CommercialIcon name="chart-no-axes-column-increasing" size={15}/>
          {showWeekly?'Ocultar evolução semanal':'Ver evolução semanal'}
          <CommercialIcon name="chevron-right" size={14}/>
        </button>
        {showWeekly&&<WeeklyChart listingId={ad.listing_id}/>}
      </div>
      <div className="nei-ad-bottom">
        <span>{focusWithoutSales?'Fonte: relatórios de vendas importados até ': 
          'Intervalo encerrado em '}{date(ad.period_end)}
          {focusWithoutSales?'.':' · Dados pendentes não equivalem a vendas zero.'}</span>
        {ad.url&&<a href={ad.url} target="_blank" rel="noopener noreferrer">Abrir anúncio no marketplace ↗</a>}
      </div>
    </div>}
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
  const cards=[
    {id:'ZERO',label:'Sem vendas',value:kpis.zero,icon:'circle-alert',detail:'Anúncios ou variações sem vendas identificadas'},
    {id:'STABLE',label:'Estável',value:kpis.stable,icon:'layout-list',detail:'Anúncios com vendas estáveis'},
    {id:'RISING',label:'Crescimento',value:kpis.rising,icon:'trending-up',detail:'Anúncios com crescimento confirmado'},
    {id:'ALL',label:'Total de anúncios',value:kpis.total,icon:'package',detail:'Total na plataforma e pesquisa, sem filtro de situação'}
  ];
  return <section className="nei-dashboard" aria-label="Evolução de vendas por anúncio">
    <div className="nei-filters">
      <label>Plataforma<select value={selectedPlatform} onChange={e=>onPlatformChange(e.target.value)}>
        {PLATFORMS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Período de comparação<select value={days} onChange={e=>{
        const v=Number(e.target.value);setDays(v);onPeriodChange(v);}}>
        {WINDOWS.map(n=><option value={n} key={n}>Últimos {n} dias</option>)}
      </select></label>
      <label>Situação das vendas<select value={status} onChange={e=>onStatusChange(e.target.value)}>
        <option value="ALL" disabled hidden>Selecionar situação</option>
        {STATUS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Pesquisar anúncio, ID ou SKU<input type="search" value={draft}
        maxLength={120} onChange={e=>setDraft(e.target.value)}
        placeholder="Nome, ID ou SKU…"/></label>
    </div>
    <div className="nei-kpis">{cards.map(card=><button type="button" key={card.id}
      className={'nei-kpi '+card.id.toLowerCase()+(status===card.id&&card.id!=='ALL'?' selected':'')}
      onClick={()=>onStatusChange(card.id)} aria-pressed={status===card.id}>
      <span className="nei-kpi-icon"><CommercialIcon name={card.icon} size={21}/></span>
      <span className="nei-kpi-copy"><small>{card.label}</small>
        <strong>{report?number(card.value):'—'} <em>anúncios</em></strong>
        <span>{card.detail}</span></span>
    </button>)}</div>
    {status!=='ZERO'&&coverage.length>0&&<p className="nei-coverage">
      Vendas registradas nos relatórios importados até {coverage.map(c=>
        platformName(c.source)+' '+date(c.end_date)).join(' · ')}.
      Os resultados são calculados somente sobre os registros importados.
    </p>}
    {status==='ZERO'&&report&&<div className="nei-zero-sales-bar">
      <strong>{number(kpis.no_sales_ads)} anúncios com 0 vendas registradas</strong>
      <strong>{number(kpis.selling_ads_with_unsold_variations)}
        {' '}anúncios com variações sem vendas</strong>
      <small>Fonte: relatórios importados até {coverage.map(c=>
        platformName(c.source)+' '+date(c.end_date)).join(' · ')}</small>
    </div>}
    {status!=='ZERO'&&report&&<div className="nei-data-overview">
      <strong>Na plataforma, independente da situação: {number(kpis.with_sales)}
        {' '}anúncios com vendas identificadas em {days} dias</strong>
      <span>{number(kpis.missing_variations)} anúncios sem variações vinculadas;
        suas vendas por ID aparecem separadamente.</span>
    </div>}
    {status!=='ALL'&&<button className="nei-clear" type="button" onClick={()=>onStatusChange('ALL')}>
      Limpar situação selecionada</button>}
    {loading&&<p className="nei-empty" role="status">Analisando anúncios e variações…</p>}
    {error&&<p className="nei-empty" role="alert">{error}
      <button type="button" onClick={()=>setRetry(x=>x+1)}>Tentar novamente</button></p>}
    {!loading&&!error&&<>
      <div className="nei-results"><strong>{number(total)} anúncio(s) no filtro</strong>
        <span>{total>0?'Exibindo '+number(offset+1)+'–'+number(Math.min(total,offset+rows.length)):
          'Nenhum anúncio confirmado para esse filtro'}</span></div>
      <div className="nei-list-head" aria-hidden="true">
        <span>Anúncio</span><span>Variações</span><span>Vendas 30 dias</span>
        <span>Vendas 60 dias</span><span>Vendas 90 dias</span><span>Situação</span><span>Detalhes</span>
      </div>
      {rows.length===0&&<p className="nei-empty">Nenhum anúncio ou variação atende a estes filtros.
        Ausência de vendas identificadas não comprova zero quando faltam relatórios.</p>}
      <div className="nei-list">{rows.map(ad=><Advertisement
        key={[selectedPlatform,days,status,search,offset,ad.listing_id].join(':')}
        ad={ad} days={days} focusWithoutSales={status==='ZERO'}
        initialExpanded={ad.listing_id===rows[0]?.listing_id}/>)}</div>
      {total>PAGE&&<footer className="nei-pagination">
        <span>Página {Math.floor(offset/PAGE)+1} de {Math.ceil(total/PAGE)}</span>
        <div><button type="button" disabled={!offset}
          onClick={()=>setOffset(n=>Math.max(0,n-PAGE))}>Anterior</button>
        <button type="button" disabled={offset+PAGE>=total}
          onClick={()=>setOffset(n=>n+PAGE)}>Próxima</button></div>
      </footer>}
    </>}
    <p className="nei-footnote">Fonte: vendas importadas, anúncios ativos e vínculos verificados de SKU.
      Os totais de 30, 60 e 90 dias são janelas acumuladas que terminam na última data importada.
      Zero identificado significa apenas ausência de vendas encontradas nos relatórios disponíveis.
      Estável e Crescimento comparam o período selecionado ao período anterior de igual duração,
      somente quando ambos têm cobertura completa. Estoque e tráfego por variação não são inferidos.</p>
  </section>;
}
