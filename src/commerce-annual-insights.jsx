import React, { useEffect, useMemo, useState } from 'react';
import { fetchCommercialManager } from './commerce-manager-fetch.js';
import './commerce-annual-insights.css';

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const fmt = value => Number(value || 0).toLocaleString('pt-BR');
const dateBR = value => value ? String(value).slice(0,10).split('-').reverse().join('/') : '—';
const pct = (cur,base) => base > 0 && cur != null ? (cur-base)*100/base : null;
const percentLabel = value => value == null ? 'Sem base' : (value>0?'+':'')+value.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
const daysLate = iso => iso ? Math.floor((Date.now()-new Date(iso+'T23:59:59Z').getTime())/86400000) : null;
const isMissing = d => !d?.base_available || !d?.current_available;
const cap = value => Math.max(0,Number(value)||0);

function useInsights({ platform,year,base,min,month,ad,refresh }) {
  const [result,setResult] = useState({ loading:true,error:'',data:null });
  useEffect(()=>{
    const controller=new AbortController();
    const url='/api/admin/commerce/sales-compare/annual-listing-insights'
      +'?platform='+encodeURIComponent(platform)
      +'&year='+year+'&base='+base+'&min='+min+'&month='+month
      +(ad?'&listing='+encodeURIComponent(ad.id)+'&listing_platform='+encodeURIComponent(ad.platform):'');
    setResult({loading:true,error:'',data:null});
    fetchCommercialManager(url,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setResult({loading:false,error:'',data});})
      .catch(error=>{if(!controller.signal.aborted)setResult({loading:false,error:error?.message||'Falha na consulta.',data:null});});
    return ()=>controller.abort();
  },[platform,year,base,min,month,ad?.id,ad?.platform,refresh]);
  return result;
}

function Change({current,base}) {
  const p=pct(current,base);
  return <span className={'gai-change '+(p==null?'neutral':p<0?'negative':p>0?'positive':'neutral')}>
    {percentLabel(p)}
  </span>;
}

function PairChart({rows,baseYear,year,selected,onMonth,maxValue,compact=false}) {
  const max=Math.max(1,maxValue||1);
  return <div className={'gai-chart'+(compact?' compact':'')} role="group" aria-label="Gráfico de unidades por mês">
    <div className="gai-chart-plot">
      {rows.map((r,i)=>{
        const current=r.cur_units??r.cur,base=r.base_units??r.base;
        const future=current==null;
        return <button type="button" key={i} className={'gai-bar-month'+(selected===i+1?' selected':'')}
          onClick={()=>onMonth?.(i+1)} aria-pressed={selected===i+1}
          aria-label={MONTHS[i]+': '+baseYear+' '+fmt(base)+' unidades; '+(future?'sem dado de '+year:year+' '+fmt(current)+' unidades')}>
          <div className="gai-pair">
            <span className="gai-bar base" style={{height:(cap(base)/max*100)+'%'}} title={baseYear+': '+fmt(base)}/>
            {!future&&<span className="gai-bar current" style={{height:(cap(current)/max*100)+'%'}} title={year+': '+fmt(current)}/>}
          </div>
          <span className="gai-month-name">{SHORT[i]}</span>
          {!compact&&<span className={'gai-month-percent '+(future?'future':(pct(current,base)<0?'negative':'positive'))}>
            {future?'—':percentLabel(pct(current,base))}
          </span>}
          {!compact&&<small className="gai-month-units">{future?(r.future?'ainda não ocorreu':'sem dados'):fmt(current)+' un.'}</small>}
        </button>;
      })}
    </div>
  </div>;
}

function ListingCard({ad,baseYear,year,onClick,active,min}) {
  const change=ad.cur-ad.base;
  const stopped=ad.base>0&&ad.cur===0;
  const fall=ad.cur<ad.base;
  return <button type="button" className={'gai-listing-card'+(active?' active':'')} onClick={onClick} aria-pressed={active}>
    <span className="gai-card-meta">{ad.platform.replace('ML_','Mercado Livre ')} · ID {ad.id}</span>
    <strong className="gai-listing-name">{ad.title}</strong>
    <span className="gai-listing-stats">
      <span><small>{baseYear}</small><strong>{fmt(ad.base)}</strong></span>
      <span><small>{year}</small><strong>{fmt(ad.cur)}</strong></span>
      <span className={'gai-card-delta '+(fall?'negative':'positive')}><small>Diferença</small><strong>{change>0?'+':''}{fmt(change)}</strong></span>
    </span>
    <span className={'gai-status '+(stopped?'stop':fall?'fall':ad.cur>=min?'good':'neutral')}>
      {stopped?'Parou de vender':fall?'Em queda':ad.cur>=min?'Vende bem':'Abaixo do limite'}
    </span>
    <span className="gai-open-label">Ver evolução anual →</span>
  </button>;
}

export default function AnnualListingInsights({platform,year,base,refresh=0}) {
  const [min,setMin]=useState(20);
  const [selected,setSelected]=useState(null);
  const [ad,setAd]=useState(null);
  const [filter,setFilter]=useState('all');
  const [visible,setVisible]=useState(3);
  useEffect(()=>{setSelected(null);setAd(null);setFilter('all');setVisible(3);},[platform,year,base]);
  const month=selected||1;
  const request=useInsights({platform,year,base,min,month,ad,refresh});
  const data=request.data;
  useEffect(()=>{
    if(data&&selected===null&&Number(data.current_month)>0) setSelected(Number(data.current_month));
  },[data?.current_month,selected]);
  const active=selected||Number(data?.current_month)||1;
  const months=Array.isArray(data?.months)?data.months:[];
  const currentMonth=months.find(m=>m.m===active);
  const complete=Boolean(data&&!isMissing(data));
  const max=Math.max(1,...months.flatMap(m=>[cap(m.base_units),cap(m.cur_units)]));
  const delta=complete?pct(data.annual?.cur,data.annual?.base):null;
  const up=complete?months.filter(m=>!m.future&&m.cur_units!=null&&m.base_units>0&&m.cur_units>m.base_units).length:0;
  const down=complete?months.filter(m=>!m.future&&m.cur_units!=null&&m.base_units>0&&m.cur_units<m.base_units).length:0;
  const focus=useMemo(()=>{
    const list=Array.isArray(data?.focus_ads)?data.focus_ads:[];
    const filtered=list.filter(r=>filter==='down'?r.cur<r.base:filter==='up'?r.cur>r.base:filter==='stop'?r.base>0&&r.cur===0:true);
    return [...filtered].sort((a,b)=>filter==='up'?(b.cur-b.base)-(a.cur-a.base):(b.base-b.cur)-(a.base-a.cur));
  },[data?.focus_ads,filter]);
  const chooseMonth=m=>{setSelected(m);setAd(null);setFilter('all');setVisible(3);};
  const openAd=item=>setAd(old=>old?.id===item.id&&old?.platform===item.platform?null:{id:item.id,platform:item.platform,title:item.title});
  const asOfOld=year===new Date().getFullYear()&&daysLate(data?.last_sale)>=2;
  const noBase=data&&!data.base_available;
  const noCurrent=data&&!data.current_available;
  const trend=Array.isArray(data?.listing_months)?data.listing_months:[];
  const trendMax=Math.max(1,...trend.flatMap(m=>[cap(m.base),cap(m.cur)]));
  // Total da plataforma: anúncios novos nunca têm venda no ano-base, então o total do ano-base é o histórico.
  const newUnits=cap(data?.new_ads?.units);
  const newCount=data?.new_ads?.count;
  const totalBase=cap(data?.annual?.base);
  const totalCur=cap(data?.annual?.cur)+newUnits;
  const staleDays=data?.last_sale?daysLate(data.last_sale):null;
  return <div className="gai-root">
    <header className="gai-heading">
      <div>
        <span className="gai-eyebrow">ANÁLISE POR ANÚNCIO · {base} × {year}</span>
        <h2>Comparação anual</h2>
        <p>Somente anúncios com vendas em {base}. Cada anúncio é identificado pelo seu ID na plataforma.</p>
      </div>
      <div className="gai-badges">
        {asOfOld&&<span className="gai-badge warning" title="Não entrou nenhuma venda nova desde a data indicada. Se você já vendeu depois disso, importe de novo a planilha de vendas.">Sem vendas há {staleDays} dias · conferir importação</span>}
        {noBase&&<span className="gai-badge warning">Sem base de {base}</span>}
        {noCurrent&&<span className="gai-badge warning">Sem dados de {year}</span>}
        {data?.last_sale&&<span className="gai-badge">Última venda: {dateBR(data.last_sale)}</span>}
      </div>
    </header>

    {request.loading&&!data&&<div className="gai-loading">Analisando o histórico dos anúncios…</div>}
    {request.error&&<div className="gai-error" role="alert">Não foi possível carregar a comparação: {request.error}</div>}
    {data&&<>
      <section className="gai-overview">
        <h3 className="gai-headline">
          {!data.base_available?'Sem base histórica para comparar os anúncios em '+base+'.':
           !data.current_available?'Ainda não há dados de vendas de '+year+' para uma comparação confiável.':
           data.annual?.base>0
             ?<>Em {year}, a plataforma vendeu <strong>{fmt(totalCur)} unidades</strong>, <Change current={totalCur} base={totalBase}/> em relação a {base}. Anúncios com histórico: {fmt(data.annual?.cur)} un. (<Change current={data.annual?.cur} base={data.annual?.base}/>). Anúncios novos: {fmt(newUnits)} un.</>
             :'Não há vendas no período equivalente de '+base+' para calcular a variação.'}
        </h3>
        <div className="gai-metrics">
          <div className="gai-metric"><span>Anúncios com histórico em {base}</span><strong>{data.base_available?fmt(data.old_count):'Sem base'}</strong><small>IDs únicos por plataforma</small></div>
          <div className="gai-metric"><span>Meses em alta / em queda</span><strong>{complete?up+' / '+down:'Sem base'}</strong><small>Comparação nas mesmas datas</small></div>
          <div className="gai-metric"><span>Anúncios com queda no ano</span><strong>{complete?fmt(data.annual?.falling_ads):'Sem base'}</strong><small>{complete?'de '+fmt(data.old_count)+' com histórico · '+fmt(data.annual?.stopped_ads)+' pararam de vender':'Histórico necessário'}</small></div>
          <div className="gai-metric"><span>Anúncios novos em {year}</span><strong>{complete&&newCount!=null?fmt(newCount):'Sem base'}</strong><small>{complete&&newCount!=null?fmt(newUnits)+' unidades · incluídos no total da plataforma':'Sem base para identificar'}</small></div>
        </div>
      </section>

      <section className="gai-panel" aria-labelledby="gai-monthly-title">
        <div className="gai-panel-head">
          <div><h3 id="gai-monthly-title">Evolução mensal da plataforma</h3><p>Barras do mesmo mês e período, em unidades (altura proporcional ao maior mês: {fmt(max)} un.). Mês em destaque: {MONTHS[active-1]}. Clique em outro mês para investigar.</p></div>
          <div className="gai-legend"><span><i className="gai-legend-base"/>{base}</span><span><i className="gai-legend-cur"/>{year}</span></div>
        </div>
        <PairChart rows={months} baseYear={base} year={year} selected={active} onMonth={chooseMonth} maxValue={max}/>
        <div className="gai-scope"><span>{data.as_of?'Comparação até '+dateBR(data.as_of):'Período atual sem dados'}</span>
          <span>{!data.base_available?'Sem base para identificar anúncios novos':data.new_ads?.count!=null&&data.current_available?'Total inclui '+fmt(data.new_ads.count)+' anúncios novos ('+fmt(data.new_ads.units)+' un.). A comparação por anúncio usa só os históricos.':'Anúncios novos não identificados'}</span>
        </div>
      </section>

      <section className="gai-panel gai-month-focus" aria-labelledby="gai-focus-title">
        <div className="gai-panel-head">
          <div><span className="gai-eyebrow">DETALHE DO MÊS</span><h3 id="gai-focus-title">{MONTHS[active-1]} · anúncios com histórico</h3><p>Comparação do mesmo anúncio nas duas temporadas.</p></div>
          <label className="gai-threshold">Vender bem a partir de <select aria-label="Limite de unidades mensais" value={min} onChange={e=>{setMin(Number(e.target.value));setAd(null);setVisible(3);}}>{[10,20,50,100].map(n=><option key={n} value={n}>{n} unidades</option>)}</select></label>
        </div>
        {!complete||currentMonth?.future?<p className="gai-empty">{currentMonth?.future?'Esse mês ainda não aconteceu em '+year+'. Os dados de '+base+' aparecem somente no gráfico.':'Sem base suficiente para comparar os anúncios deste mês.'}</p>:<>
          <p className="gai-month-sentence"><strong>{fmt(currentMonth?.base_strong)}</strong> anúncios venderam bem em {base}. Em {year}: <strong className="gai-positive">{fmt(currentMonth?.kept)} seguem bem</strong> e <strong className="gai-negative">{fmt(currentMonth?.lost)} perderam força</strong>.</p>
          <div className="gai-healthbar" title={fmt(currentMonth?.kept)+' mantidos · '+fmt(currentMonth?.lost)+' em queda'}>
            <span style={{width:((currentMonth?.kept||0)/Math.max(1,currentMonth?.base_strong||0)*100)+'%'}}/>
          </div>
          {currentMonth?.stopped>0&&currentMonth?.new_strong>0&&<p className="gai-caution">Há anúncios antigos sem vendas e anúncios novos com bom volume neste mês. Pode ter ocorrido migração de vendas, mas os dados não comprovam a relação.</p>}
          <div className="gai-detail-filters" role="group" aria-label="Filtrar desempenho dos anúncios">
            {[['all','Destaques'],['down','Em queda'],['up','Em alta'],['stop','Pararam']].map(([id,label])=><button type="button" key={id} className={filter===id?'active':''} aria-pressed={filter===id} onClick={()=>{setFilter(id);setVisible(3);setAd(null);}}>{label}</button>)}
          </div>
          {focus.length===0?<p className="gai-empty">Não há anúncios nesta categoria com pelo menos {min} unidades em {base} no mês.</p>:
            <div className="gai-listing-grid">{focus.slice(0,visible).map(item=><ListingCard key={item.platform+':'+item.id} ad={item} year={year} baseYear={base} min={min} active={ad?.id===item.id&&ad?.platform===item.platform} onClick={()=>openAd(item)}/>)}</div>}
          {focus.length>visible&&<button type="button" className="gai-more" onClick={()=>setVisible(n=>n+3)}>Ver mais anúncios ({fmt(focus.length-visible)} restantes)</button>}
          {ad&&<div className="gai-ad-drill">
            <div className="gai-panel-head"><div><span className="gai-eyebrow">{ad.platform} · ID {ad.id}</span><h4>{ad.title}</h4><p>O mesmo ID comparado mês a mês. Linha de força: {min} unidades.</p></div><button type="button" className="gai-close" onClick={()=>setAd(null)}>Fechar</button></div>
            {trend.length===12?<PairChart compact rows={trend} year={year} baseYear={base} selected={active} onMonth={chooseMonth} maxValue={trendMax}/>:<p className="gai-empty">Carregando histórico do anúncio…</p>}
          </div>}
        </>}
      </section>

      <section className="gai-panel gai-month-list">
        <div className="gai-panel-head"><div><h3>Leitura mês a mês</h3><p>Resumo sem tabelas. Selecione um mês para ver seus anúncios.</p></div></div>
        <div className="gai-summary-list">{months.map(m=>{
          const future=m.future||!data.current_available;
          const total=Math.max(1,m.base_strong||0);
          return <button type="button" key={m.m} className={'gai-summary-row'+(active===m.m?' active':'')} onClick={()=>chooseMonth(m.m)}>
            <span className="gai-summary-label">{MONTHS[m.m-1]}</span>
            <span className="gai-summary-copy">{future
              ?fmt(m.base_units)+' unidades em '+base+' · '+(m.future?'mês futuro':'sem dados comparáveis')
              :<>{fmt(m.base_strong)} vendiam bem em {base}. <b>{fmt(m.kept)} seguem bem</b>, <b>{fmt(m.lost)} caíram</b>.</>}</span>
            {!future&&<span className="gai-summary-bar"><i style={{width:(m.kept/total*100)+'%'}}/></span>}
            <span className="gai-summary-action">Ver mês →</span>
          </button>;
        })}</div>
      </section>
    </>}
  </div>;
}
