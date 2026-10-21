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
const situationName=s=>({
  ZERO:'Sem vendas',STABLE:'Estável',RISING:'Crescimento',
  FALLING:'Revisar queda',INSUFFICIENT:'Dados pendentes'
})[s]||'Dados pendentes';

function Value({value,identified=null}){
  return <span className="nei-value">{known(value)?number(value)+' un.':
    known(identified)&&Number(identified)>0?'≥ '+number(identified)+' un.':'—'}</span>;
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
  const st=variationState(variation,days);
  if(st==='LINK'){
    const why=variation.match_issue==='MISSING_SKU'?'SKU ausente no catálogo':
      variation.match_issue==='DUPLICATE_SKU'?'SKU duplicado entre variações':
      'Vínculo de SKU ainda não aprovado';
    return <div className="nei-reason"><strong>Identificação pendente · {why}</strong>
      <p>Corrija ou aprove o vínculo antes de concluir que esta variação não vendeu.</p></div>;
  }
  if(st==='UNKNOWN')return <div className="nei-reason">
    <strong>Período com cobertura incompleta</strong>
    <p>Não é possível afirmar vendas zero. Importe os relatórios dos dias ausentes.</p>
  </div>;
  if(st==='ZERO'){
    const earlier=days===30&&known(variation.units_60)&&variation.units_60>0
      ?'Há vendas anteriores dentro da janela de 60 dias.':'';
    return <div className="nei-reason">
      <strong>Sem vendas confirmadas em {days} dias</strong>
      <p>{earlier} {Number(ad.sold_variations)>0?'Outras variações do anúncio venderam.':''}
        {' '}Para investigar a causa, confira estoque, preço, apresentação, disponibilidade e tráfego da variação.
        Essas causas ainda não são comprovadas pelos relatórios.</p>
    </div>;
  }
  return null;
}
function VariationTable({ad,days}){
  const [issuesOnly,setIssuesOnly]=useState(false);
  const all=Array.isArray(ad.variations)?ad.variations:[];
  const shown=all.filter(v=>!issuesOnly||['ZERO','LINK','UNKNOWN'].includes(variationState(v,days)));
  return <div className="nei-variations">
    <div className="nei-subheading"><strong>Variações do anúncio ({number(all.length)})</strong>
      <label><input type="checkbox" checked={issuesOnly}
        onChange={e=>setIssuesOnly(e.target.checked)}/> Apenas sem vendas ou pendentes</label></div>
    <div className="nei-table-scroll"><table><thead><tr>
      <th>Variação / SKU</th>{WINDOWS.map(n=><th key={n}>Vendas {n} dias</th>)}
      <th>Situação</th><th>Observações e possíveis motivos</th>
    </tr></thead><tbody>{shown.map(v=>{
      const st=variationState(v,days);
      return <tr key={v.id}>
        <td><strong>{v.name}</strong><small>{v.sku||'SKU não informado'}</small></td>
        {WINDOWS.map(n=><td key={n}><Value value={variationSales(v,n)}
          identified={v.match_verified?v['identified_'+n]:null}/></td>)}
        <td><span className={'nei-pill '+st.toLowerCase()}>{({
          ZERO:'Sem vendas',SOLD:'Com vendas',PARTIAL:'Venda identificada',
          LINK:'SKU pendente',UNKNOWN:'Sem comprovação'
        })[st]}</span></td>
        <td><Investigation variation={v} days={days} ad={ad}/>{!['ZERO','LINK','UNKNOWN'].includes(st)
          &&<small>Venda identificada; acompanhar desempenho.</small>}</td>
      </tr>;
    })}</tbody></table></div>
    {shown.length===0&&<p className="nei-empty">Nenhuma variação com pendência identificada neste anúncio.</p>}
  </div>;
}
function VariationSummary({ad,days}){
  const variations=Array.isArray(ad.variations)?ad.variations:[];
  const counts=variations.reduce((acc,v)=>{
    const state=variationState(v,days);
    if(state==='SOLD'||state==='PARTIAL')acc.sold++;
    else if(state==='ZERO')acc.zero++;
    else acc.pending++;
    return acc;
  },{sold:0,zero:0,pending:0});
  return <div className="nei-variation-summary" aria-label={'Resumo das variações nos últimos '+days+' dias'}>
    <strong>Variações · {days} dias</strong>
    <div className="nei-variation-stats">
      <span><b className="nei-stat-sold">{number(counts.sold)}</b><small>Com vendas identificadas</small></span>
      <span><b className="nei-stat-zero">{number(counts.zero)}</b><small>Sem vendas confirmadas</small></span>
      <span><b>{number(counts.pending)}</b><small>Dados pendentes</small></span>
    </div>
  </div>;
}
function Advertisement({ad,days}){
  const [expanded,setExpanded]=useState(false);
  const [showWeekly,setShowWeekly]=useState(false);
  const badge=ad.situation||'INSUFFICIENT';
  const unitLabel=n=>known(ad['units_'+n])?number(ad['units_'+n])+' un.':
    Number(ad['identified_'+n])>0?'≥ '+number(ad['identified_'+n])+' un.':'—';
  return <article className={'nei-ad '+(expanded?'expanded':'')}>
    <button type="button" className="nei-ad-summary" onClick={()=>setExpanded(!expanded)}
      aria-expanded={expanded} aria-label={'Detalhes do anúncio '+ad.external_listing_id}>
      <span className="nei-ad-icon"><CommercialIcon name="notebook-tabs" size={19}/></span>
      <span className="nei-ad-main"><strong>{ad.title||'Anúncio sem título'}</strong>
        <small>{platformName(ad.source)} · ID: {ad.external_listing_id}</small></span>
      <span className="nei-ad-var-count">{number(ad.variation_count)} variações
        {Number(ad.zero_variations)>0&&<small>{number(ad.zero_variations)} sem vendas</small>}
      </span>
      {WINDOWS.map(n=><span key={n} className="nei-ad-period">{unitLabel(n)}</span>)}
      <span className={'nei-pill '+badge.toLowerCase()}>{situationName(badge)}</span>
      <span className={'nei-chevron '+(expanded?'turned':'')}><CommercialIcon name="chevron-right" size={17}/></span>
    </button>
    {expanded&&<div className="nei-ad-expanded">
      <div className="nei-ad-overview">
        <div className="nei-window-cards">{WINDOWS.map(n=><div className="nei-window-card" key={n}>
          <small>Vendas {n} dias</small>
          <strong>{unitLabel(n)}</strong>
          <span>{known(ad['units_'+n])?'Total confirmado':
            Number(ad['identified_'+n])>0?'Mínimo identificado':'Cobertura insuficiente'}</span>
        </div>)}</div>
        <VariationSummary ad={ad} days={days}/>
      </div>
      <VariationTable ad={ad} days={days}/>
      <div className="nei-weekly-section">
        <button type="button" className="nei-weekly-toggle" aria-expanded={showWeekly}
          onClick={()=>setShowWeekly(open=>!open)}>
          <CommercialIcon name="chart-no-axes-combined" size={15}/>
          {showWeekly?'Ocultar evolução semanal':'Ver evolução semanal'}
          <CommercialIcon name={showWeekly?'chevron-up':'chevron-down'} size={14}/>
        </button>
        {showWeekly&&<WeeklyChart listingId={ad.listing_id}/>}
      </div>
      <div className="nei-ad-bottom">
        <span>Intervalo encerrado em {date(ad.period_end)}. Dados pendentes não equivalem a vendas zero.</span>
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
    {id:'ZERO',label:'Sem vendas',value:kpis.zero,icon:'circle-alert',detail:'Anúncios sem venda confirmada'},
    {id:'STABLE',label:'Estável',value:kpis.stable,icon:'layout-list',detail:'Anúncios com vendas estáveis'},
    {id:'RISING',label:'Crescimento',value:kpis.rising,icon:'trending-up',detail:'Anúncios com crescimento confirmado'},
    {id:'ALL',label:'Total no filtro',value:kpis.total,icon:'package',detail:'Anúncios com variações cadastradas'}
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
    {coverage.length>0&&<p className="nei-coverage">Cobertura dos relatórios: {coverage.map(c=>
      platformName(c.source)+' até '+date(c.end_date)+' ('+
      (c['complete_'+days]?'período completo':'período incompleto')+')').join(' · ')}.
      Apenas anúncios com dados completos e SKU validado recebem situação confirmada.</p>}
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
        <span>Vendas 60 dias</span><span>Vendas 90 dias</span><span>Situação</span><span/>
      </div>
      {rows.length===0&&<p className="nei-empty">Nenhum anúncio com variações atende ao filtro.
        Anúncios sem cobertura não são classificados como sem vendas.</p>}
      <div className="nei-list">{rows.map(ad=><Advertisement key={ad.listing_id}
        ad={ad} days={days}/>)}</div>
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
      Estável e Crescimento comparam o período selecionado ao período anterior de igual duração,
      somente quando ambos têm cobertura completa. Estoque e tráfego por variação não são inferidos.</p>
  </section>;
}
