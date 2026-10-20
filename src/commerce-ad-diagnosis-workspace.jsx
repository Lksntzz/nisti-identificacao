import React,{useEffect,useMemo,useState} from 'react';
import {commerceApi} from './commerce-admin-api.js';
import {analyzeTrafficWindow,trafficDerivedRates} from './commerce-traffic-analysis.js';
import {buildListingDiagnosis} from './commerce-listing-diagnostics.js';
import CommerceTrafficMetrics from './commerce-traffic-metrics.jsx';
import {
  adDiagnosisStatus,adPeriodValues,adNoSalesVariantCount,adMatchesFilter,
  diagnosisFromEvidence,percentChange,reportUnits,reportMoney,SHORT_DATE
} from './commerce-ad-diagnosis-model.js';
import './commerce-ad-diagnosis-workspace.css';

const API='/api/admin/commerce/listings/manager';
const PLATFORMS=[['TODAS','Todas as plataformas'],['SHOPEE','Shopee'],
  ['MERCADO_LIVRE','Todo Mercado Livre'],['ML_ANTIGO','ML Antigo'],['ML_NOVO','ML Novo']];
const STATUS=[['ALL','Todos'],['SOLD','Com vendas'],['ZERO','Sem vendas'],
  ['STABLE','Estáveis'],['RISING','Em crescimento'],['FALLING','Em queda']];
const PAGE=20;
const percentage=value=>value==null?'—':(value>0?'+':'')+
  new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value)+'%';
const timeBack=(date,days)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return null;
  const dt=new Date(date+'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate()-days);
  return dt.toISOString().slice(0,10);
};
const sourceName=s=>s==='SHOPEE'?'Shopee':s==='ML_NOVO'?'Mercado Livre Novo':
  s==='ML_ANTIGO'?'Mercado Livre Antigo':s||'Plataforma';
async function fetchManager({platform,days,month,status,search,offset,limit,signal}) {
  const params=new URLSearchParams({platform,days:String(days),status,
    curve:'ALL',basis:'REVENUE',search,offset:String(offset),limit:String(limit)});
  if(days===0&&month)params.set('month',month);
  return commerceApi(API+'?'+params,{cache:'no-store',signal});
}
async function fetchStableListings({platform,days,month,search,signal}) {
  const first=await fetchManager({platform,days,month,status:'ALL',search,offset:0,limit:100,signal});
  const total=Number(first.total)||0;
  if(total>5000)throw Error('Há mais de 5.000 anúncios. Use plataforma ou busca para filtrar os estáveis.');
  const items=[...(first.items||[])];
  // A operação é intencionalmente global: "Estáveis" não pode filtrar só a página atual.
  for(let offset=100;offset<total;offset+=100){
    if(signal.aborted)throw Error('Cancelado');
    const page=await fetchManager({platform,days,month,status:'ALL',search,offset,limit:100,signal});
    items.push(...(page.items||[]));
  }
  return {...first,items:items.filter(item=>adMatchesFilter(item,'STABLE')),
    total:items.filter(item=>adMatchesFilter(item,'STABLE')).length};
}
function Graphic({data,scope}) {
  const rows=Array.isArray(data?.items)?data.items:[];
  const visible=rows.filter(x=>x.units!==null||x.visits!==null);
  if(!rows.length||!visible.length)return <div className="nad-chart-empty">
    Não há série diária de vendas ou visitas registrada neste intervalo.
    Importações por período não são transformadas em dados diários fictícios.
  </div>;
  const w=700,h=190,l=46,r=26,t=17,b=35;
  const dx=i=>l+i*(w-l-r)/Math.max(rows.length-1,1);
  const maxFor=key=>Math.max(1,...rows.map(x=>x[key]==null?0:Number(x[key])));
  const ymax={units:maxFor('units'),visits:maxFor('visits')};
  const yp=(n,key)=>t+(h-t-b)*(1-Number(n)/ymax[key]);
  const lineParts=key=>{
    const segments=[];let points=[];
    rows.forEach((row,i)=>{
      if(row[key]==null){if(points.length)segments.push(points);points=[];return;}
      points.push({x:dx(i),y:yp(row[key],key),date:row.date,value:row[key]});
    });
    if(points.length)segments.push(points);
    return segments;
  };
  const hasSales=rows.some(x=>x.units!=null),hasVisits=rows.some(x=>x.visits!=null);
  const colors={units:'#fb6684',visits:'#3898ff'};
  return <div className="nad-chart">
    <div className="nad-chart-legend"><span><i className="sales"/>Vendas identificadas</span>
      <span><i className="visits"/>Visitas ({scope==='PAID'?'pagas':scope==='ORGANIC'?'orgânicas':'totais'})</span></div>
    <svg viewBox="0 0 700 190" role="img" aria-label="Evolução diária de vendas vinculadas e visitas registradas, com escalas independentes">
      {[0,.25,.5,.75,1].map(v=><line key={v} x1={l} x2={w-r}
        y1={t+(h-t-b)*v} y2={t+(h-t-b)*v} stroke="#324661" strokeOpacity=".55"/>)}
      {['visits','units'].map(key=>lineParts(key).map((part,i)=><g key={key+i}>
        {part.length>1&&<polyline points={part.map(p=>p.x+','+p.y).join(' ')}
          stroke={colors[key]} fill="none" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round"/>}
        {part.map((p,j)=><circle key={j} cx={p.x} cy={p.y} r="2.6" fill={colors[key]}>
          <title>{SHORT_DATE(p.date)} · {key==='units'?'Unidades vinculadas':'Visitas'}: {reportUnits(p.value)}</title>
        </circle>)}
      </g>))}
      {rows.filter((_,i)=>i===0||i===rows.length-1||i%Math.max(1,Math.ceil(rows.length/6))===0)
        .map((row)=><text key={row.date} x={dx(rows.indexOf(row))} y={h-9}
          textAnchor="middle" fontSize="10" fill="#99aecb">{row.date?.slice(8,10)+'/'+row.date?.slice(5,7)}</text>)}
    </svg>
    <p>{hasSales?'Vendas: somente registros diários vinculados.':'Vendas diárias indisponíveis.'} {' '}
      {hasVisits?'Visitas: registros diários do escopo selecionado.':'Visitas diárias não importadas.'}
      {' '}As séries usam escalas independentes. Datas sem registro não são exibidas como zero.</p>
    {data?.sales_attribution&&<p>{data.sales_attribution}.</p>}
  </div>;
}
function Kpi({label,value,detail,change,tone}) {
  return <div className={'nad-kpi '+(tone||'')}><small>{label}</small><strong>{value}</strong>
    {change!=null&&<span className={change<0?'negative':change>0?'positive':''}>{percentage(change)}</span>}
    <p>{detail}</p></div>;
}
export default function CommerceAdDiagnosisWorkspace({revision=0,salesRevision=0}) {
  const [platform,setPlatform]=useState('TODAS'),[days,setDays]=useState(30);
  const [status,setStatus]=useState('ALL'),[month,setMonth]=useState('');
  const [draft,setDraft]=useState(''),[search,setSearch]=useState('');
  const [page,setPage]=useState(0),[refresh,setRefresh]=useState(0);
  const [result,setResult]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [selectedId,setSelectedId]=useState(null),[scope,setScope]=useState('ALL');
  const [traffic,setTraffic]=useState(null),[daily,setDaily]=useState(null);
  const [detailBusy,setDetailBusy]=useState(false),[detailError,setDetailError]=useState('');
  const [trafficRevision,setTrafficRevision]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setSearch(draft.trim()),300);return ()=>clearTimeout(t);},[draft]);
  useEffect(()=>{setPage(0);setSelectedId(null);},[platform,days,month,status,search]);
  useEffect(()=>{
    const ctrl=new AbortController();
    if(days===0&&!month){setResult(null);setLoading(false);setError('');return ()=>ctrl.abort();}
    setLoading(true);setError('');setResult(null);
    const opts={platform,days,month,search,signal:ctrl.signal};
    const request=status==='STABLE'?fetchStableListings(opts):
      fetchManager({...opts,status:status==='SOLD'?'SOLD':status==='ZERO'?'ZERO':status,
        offset:page*PAGE,limit:PAGE});
    request.then(x=>{if(!ctrl.signal.aborted)setResult(x);})
      .catch(e=>{if(!ctrl.signal.aborted)setError(e.message);})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[platform,days,month,status,search,page,revision,salesRevision,refresh]);
  const rows=Array.isArray(result?.items)?result.items:[];
  const shown=status==='STABLE'?rows.slice(page*PAGE,(page+1)*PAGE):rows;
  const selected=shown.find(x=>String(x.id)===String(selectedId))||shown[0]||null;
  const start=result?.period_start||null,end=result?.period_end||null;
  const trafficCurrent=traffic?.current?.[scope]||null;
  const trafficPrevious=traffic?.previous?.[scope]||null;
  useEffect(()=>{
    setTraffic(null);setDaily(null);setDetailError('');
    if(!selected?.id||!start||!end)return;
    const ctrl=new AbortController();setDetailBusy(true);
    const args=new URLSearchParams({start,end,scope});
    Promise.allSettled([
      commerceApi(API+'/'+encodeURIComponent(selected.id)+'/traffic?'+new URLSearchParams({start,end}),
        {cache:'no-store',signal:ctrl.signal}),
      commerceApi(API+'/'+encodeURIComponent(selected.id)+'/daily?'+args,
        {cache:'no-store',signal:ctrl.signal})
    ]).then(results=>{
      if(ctrl.signal.aborted)return;
      if(results[0].status==='fulfilled')setTraffic(results[0].value);
      if(results[1].status==='fulfilled')setDaily(results[1].value);
      const failures=results.filter(r=>r.status==='rejected');
      if(failures.length)setDetailError('Parte das métricas não pôde ser carregada. Tente atualizar.');
    }).finally(()=>{if(!ctrl.signal.aborted)setDetailBusy(false);});
    return ()=>ctrl.abort();
  },[selected?.id,start,end,scope,trafficRevision]);
  const state=adDiagnosisStatus(selected);
  const sales=adPeriodValues(selected,days);
  const visitRates=trafficDerivedRates(trafficCurrent);
  const analysis=analyzeTrafficWindow(trafficCurrent,trafficPrevious);
  const diagnostic=diagnosisFromEvidence(selected,analysis);
  const checklist=selected?buildListingDiagnosis(selected,days).checks:[];
  const variations=selected?(selected.ready&&selected.variation_data_complete
    ?selected.variations||[]:selected.identified_variations||[]):[];
  const trustworthyVariations=Boolean(selected?.ready&&selected?.variation_data_complete);
  const pages=Math.max(1,Math.ceil((Number(result?.total)||0)/PAGE));
  const previousStart=timeBack(start,days===0?(start&&end?(Date.parse(end)-Date.parse(start))/86400000+1:0):days);
  const previousEnd=timeBack(start,1);
  return <section className="nad-workspace" aria-label="Evolução de Anúncios e Diagnóstico">
    <header className="nad-heading"><div><h2>Evolução de Anúncios <span>/ Diagnóstico</span></h2>
      <p>Investigue quedas, identifique evidências e decida o que corrigir em cada anúncio.</p></div>
      <div className="nad-head-actions"><small>Dados de vendas até {SHORT_DATE(result?.data_through||end)}</small>
        <button type="button" onClick={()=>setRefresh(v=>v+1)}>↻ Atualizar</button></div></header>
    <div className="nad-filters">
      <label>Plataforma<select value={platform} onChange={e=>setPlatform(e.target.value)}>
        {PLATFORMS.map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </select></label>
      <fieldset className="nad-period"><legend>Período de análise</legend>
        {([7,30,60,90]).map(p=><button key={p} className={days===p?'active':''}
          type="button" aria-pressed={days===p} onClick={()=>setDays(p)}>{p} dias</button>)}
        <button type="button" className={days===0?'active':''} onClick={()=>setDays(0)}>Mês personalizado</button>
        {days===0&&<input aria-label="Mês personalizado" type="month" value={month}
          min="2025-01" max={new Date().toISOString().slice(0,7)} onChange={e=>setMonth(e.target.value)}/>}
      </fieldset>
      <fieldset className="nad-status-filters"><legend>Desempenho</legend>
        {STATUS.map(([id,label])=><button key={id} type="button" className={status===id?'active':''}
          aria-pressed={status===id} onClick={()=>setStatus(id)}>{label}</button>)}
      </fieldset>
    </div>
    <div className="nad-search"><input value={draft} type="search" maxLength={120}
      onChange={e=>setDraft(e.target.value)} placeholder="Buscar por título, ID do anúncio ou SKU…"
      aria-label="Buscar anúncios"/><button type="button" onClick={()=>{
        setPlatform('TODAS');setDays(30);setMonth('');setStatus('ALL');setDraft('');setSearch('');
      }}>Limpar filtros</button></div>
    {error&&<p className="nad-error" role="alert">{error}</p>}
    {loading&&<p className="nad-loading" role="status">Consultando anúncios e vendas importadas…</p>}
    {!loading&&!error&&<div className="nad-main">
      <aside className="nad-list" aria-label="Lista de anúncios">
        <div className="nad-list-heading"><h3>Lista de Anúncios</h3>
          <span>{reportUnits(result?.total||0)} anúncios encontrados</span></div>
        <div className="nad-list-items">
          {shown.map(item=>{
            const trend=adDiagnosisStatus(item);
            const values=adPeriodValues(item,days);
            return <button key={item.id} type="button"
              className={'nad-list-item '+(selected?.id===item.id?'selected':'')}
              aria-pressed={selected?.id===item.id}
              onClick={()=>setSelectedId(item.id)}>
              <span className={'nad-dot '+trend.tone}/>
              <span className="nad-list-identity"><strong>{item.title||'Anúncio sem título'}</strong>
                <small>ID {item.external_listing_id||'—'} · {sourceName(item.source)}</small>
                <small>{values.units===null?'Vendas sem vínculo confirmado':
                  reportUnits(values.units)+' un. '+(values.partial?'identificadas':'vendidas')}</small>
              </span>
              <span className={'nad-list-trend '+trend.tone}><b>{percentage(trend.growth)}</b>
                <small>{trend.label}</small></span></button>;
          })}
          {shown.length===0&&<p className="nad-list-empty">Nenhum anúncio encontrado. Sem registros não significa venda zero.</p>}
        </div>
        <div className="nad-pages"><button type="button" disabled={page===0} onClick={()=>{setPage(p=>p-1);setSelectedId(null);}}>Anterior</button>
          <span>{page+1} / {pages}</span>
          <button type="button" disabled={page+1>=pages} onClick={()=>{setPage(p=>p+1);setSelectedId(null);}}>Próxima</button></div>
      </aside>
      {selected?<div className="nad-detail" key={selected.id}>
        <header className="nad-ad-title"><div><div className="nad-title-badges">
          <span className={'nad-chip '+state.tone}>{state.label}</span>
          <span className="nad-source">{sourceName(selected.source)}</span>
          {selected.curve&&<span className="nad-curve">ABC {selected.curve}{selected.curve_partial?' · indicativa':''}</span>}</div>
          <h3>{selected.title}</h3><p>ID do anúncio: {selected.external_listing_id||'Não informado'}</p>
          <p>Análise: {SHORT_DATE(start)} a {SHORT_DATE(end)}
            {previousStart&&' · anterior: '+SHORT_DATE(previousStart)+' a '+SHORT_DATE(previousEnd)}</p></div>
          {selected.url&&<a href={selected.url} target="_blank" rel="noopener noreferrer">Ver no marketplace ↗</a>}
        </header>
        <div className="nad-kpis">
          <Kpi label={sales.partial?'Unidades identificadas':'Unidades vendidas'} value={reportUnits(sales.units)}
            change={percentChange(sales.units,sales.previousUnits)}
            detail={sales.previousUnits==null?'Sem período anterior comparável':
              'Anterior: '+reportUnits(sales.previousUnits)+' unidades'} tone="sales"/>
          <Kpi label={'Visitas · '+(scope==='PAID'?'pago':scope==='ORGANIC'?'orgânico':'total')}
            value={reportUnits(trafficCurrent?.visits)} detail={trafficPrevious?.visits==null?
            'Relatório de visitas não disponível':'Anterior: '+reportUnits(trafficPrevious.visits)}
            change={percentChange(trafficCurrent?.visits,trafficPrevious?.visits)} tone="visits"/>
          <Kpi label="Conversão · pedidos/visita"
            value={visitRates.conversion==null?'—':percentage(visitRates.conversion*100)}
            detail="Somente pedidos e visitas do mesmo relatório" tone="conversion"/>
          <Kpi label={sales.partial?'Faturamento identificado':'Faturamento bruto'}
            value={reportMoney(sales.revenue)} detail="Receita dos produtos, não lucro líquido" tone="revenue"/>
        </div>
        {sales.partial&&<p className="nad-coverage">Vínculo Shopee parcial: valores identificados por SKU não comprovam o total deste anúncio.</p>}
        <div className="nad-analysis-grid">
          <section className="nad-chart-panel"><div className="nad-panel-heading"><h4>Evolução diária de visitas e vendas</h4>
            <label>Origem das visitas<select value={scope} onChange={e=>setScope(e.target.value)}>
              <option value="ALL">Total</option><option value="ORGANIC">Orgânico</option>
              <option value="PAID">Pago</option></select></label></div>
            {detailBusy?<p className="nad-loading">Consultando série diária…</p>:
              <Graphic data={daily} scope={scope}/>}
            {detailError&&<p className="nad-error" role="alert">{detailError}</p>}
          </section>
          <section className={'nad-primary '+diagnostic.tone}>
            <div className="nad-panel-heading"><h4>Diagnóstico principal</h4>
              <span>{diagnostic.evidence}</span></div>
            <strong>{diagnostic.label}</strong><p>{diagnostic.why}</p>
            {analysis.evidence.length>0&&<div className="nad-findings">
              {analysis.evidence.map(s=><p key={s.key}><b>{s.label}:</b> {s.text}</p>)}</div>}
            <p className="nad-diagnosis-warning">Indício não é prova de causalidade.
              Valores ausentes não são considerados zero.</p>
          </section>
        </div>
        <div className="nad-decision-grid">
          <section className="nad-causes"><h4>Possíveis causas a verificar</h4>
            {checklist.map((c,i)=><div className="nad-cause" key={c.id}>
              <span className="nad-cause-num">{i+1}</span>
              <div><strong>{c.title}</strong><small>{c.id==='traffic'&&trafficCurrent&&trafficPrevious?
                'Há relatórios comparáveis para o escopo selecionado.':c.detail}</small></div>
              {c.id==='traffic'
                ?<a href="#nad-reports">Relatórios ↗</a>
                :selected.url?<a href={selected.url} target="_blank" rel="noopener noreferrer">Verificar ↗</a>
                :<small>Sem link</small>}
            </div>)}
          </section>
          <section className="nad-actions"><h4>Próximas ações recomendadas</h4>
            {checklist.slice(0,4).map((c,i)=><div className="nad-action" key={c.id}>
              <b>{i+1}</b><div><strong>{c.action}</strong>
                <small>{c.status}. Confirme no marketplace antes de alterar o anúncio.</small></div></div>)}
            <div className="nad-action-buttons">
              {selected.url&&<a target="_blank" rel="noopener noreferrer" href={selected.url}>Abrir anúncio para avaliar</a>}
              <a href="#nad-variations">Ver variações ↓</a></div>
          </section>
        </div>
        <section className="nad-variations" id="nad-variations">
          <header><h4>Variações do anúncio ({reportUnits(selected.total_variations||0)})</h4>
            <span>{trustworthyVariations?'Vendas vinculadas por variação':'Vínculos parciais por SKU'}</span></header>
          <div className="nad-table-scroll"><table><thead><tr>
            <th>Variação / SKU</th><th>Vendas no período</th><th>Período anterior</th>
            <th>Diagnóstico da variação</th>
          </tr></thead><tbody>
            {variations.map((v,i)=>{
              const n=v.units==null?null:Number(v.units);
              const label=n==null?'Dados pendentes':n===0
                ?(trustworthyVariations?'Sem vendas':'Sem vendas identificadas'):'Com vendas';
              return <tr key={String(v.id||v.sku||i)}><td><b>{v.name||'Variação'}</b><small>{v.sku||'SKU não informado'}</small></td>
                <td>{reportUnits(v.units)}</td><td>—</td><td>{label}</td></tr>;
            })}
            {!variations.length&&<tr><td colSpan={4}>Não há vínculo individual confiável de variações neste anúncio.</td></tr>}
          </tbody></table></div>
          <p>O relatório atual não contém histórico anterior exclusivo de cada variação; não atribuímos queda por SKU sem essa evidência.
            {adNoSalesVariantCount(selected)>0&&' '+reportUnits(adNoSalesVariantCount(selected))+' variações sem vendas confirmadas.'}</p>
        </section>
        <details className="nad-reports" id="nad-reports"><summary>Consultar ou registrar métricas reais de tráfego</summary>
          <CommerceTrafficMetrics listingId={selected.id} start={start} end={end}
            onSaved={()=>setTrafficRevision(n=>n+1)}/></details>
      </div>:<div className="nad-no-selection">Nenhum anúncio corresponde aos filtros selecionados.</div>}
    </div>}
    <p className="nad-footnote">Base de vendas: importações e conciliações existentes do NISTI.
      Impressões, CTR, visitas e conversão são exibidos somente quando um relatório do período foi registrado.
      Não são fabricados dados de visitas, histórico de variações, preços concorrentes ou análises de causalidade.</p>
  </section>;
}
