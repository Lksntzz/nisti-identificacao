import React, { useEffect, useMemo, useState } from 'react';
import CommerceSkuListingsView from './commerce-sku-listings-view.jsx';
import CommerceSalesDashboard from './commerce-sales-dashboard.jsx';
import CommerceAbcAdPerformance from './commerce-abc-ad-performance.jsx';
import CommerceSalesVelocity from './commerce-sales-velocity.jsx';
import CommerceImportCenter from './commerce-import-center.jsx';
import './commerce-commercial-dashboard.css';

const PLATFORM_OPTIONS = [
  ['TODAS','Todas as plataformas'],
  ['MERCADO_LIVRE','Mercado Livre'],
  ['SHOPEE','Shopee'],
  ['AMAZON','Amazon'],
  ['TIKTOK','TikTok']
];
const CURVES = [
  {code:'A',title:'Curva A',subtitle:'Maior impacto nas vendas',cutoff:'Primeiros 80%'},
  {code:'B',title:'Curva B',subtitle:'Desempenho intermediário',cutoff:'Próximos 15%'},
  {code:'C',title:'Curva C',subtitle:'Menor impacto nas vendas',cutoff:'Últimos 5%'}
];
const number = v => new Intl.NumberFormat('pt-BR').format(Number(v || 0));
const money = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v || 0));
const monthLabel = v => {
  if (!/^\d{4}-\d{2}$/.test(String(v || ''))) return v;
  return new Date(v + '-02T12:00:00').toLocaleDateString('pt-BR',{month:'short',year:'2-digit'});
};

async function fetchJson(url) {
  const response = await fetch(url,{credentials:'same-origin',cache:'no-store'});
  const json = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(json.error || 'Falha ao carregar os indicadores.');
  return json;
}

function Metric({label,value,foot,icon,tone}) {
  return <article className="nisti-com-metric">
    <div><span>{label}</span><strong>{value}</strong><small>{foot}</small></div>
    <span className={'nisti-com-metric-icon '+tone} aria-hidden="true">{icon}</span>
  </article>;
}

function SalesHistoryChart({history,basis}) {
  const rows = Array.isArray(history) ? history : [];
  const values = rows.map(r=>Math.max(0,Number(basis==='UNITS'?r.units:r.product_revenue)||0));
  const max = Math.max(1,...values);
  if (!rows.length) {
    return <div className="nisti-com-placeholder">Aguardando importação das vendas para gerar o gráfico.</div>;
  }
  return <div className="nisti-com-chart" role="img" aria-label={'Evolução mensal de '+(basis==='UNITS'?'unidades':'faturamento')}>
    {rows.map((r,i)=><div className="nisti-com-chart-col" key={r.period_key}>
      <div className="nisti-com-chart-bar-wrap">
        <div className="nisti-com-chart-bar" style={{height:(values[i]/max*100)+'%'}}
          title={monthLabel(r.period_key)+' · '+(basis==='UNITS'?number(r.units)+' unidades':money(r.product_revenue))}/>
      </div>
      <small>{monthLabel(r.period_key)}</small>
    </div>)}
  </div>;
}

export default function CommerceCommercialDashboard({salesRevision=0}) {
  const [platform,setPlatform] = useState('TODAS');
  const [basis,setBasis] = useState('REVENUE');
  const [days,setDays] = useState(30);
  const [referenceMonth,setReferenceMonth] = useState('');
  const [importOpen,setImportOpen] = useState(false);
  const [search,setSearch] = useState('');
  const [debouncedSearch,setDebouncedSearch] = useState('');
  const [activeCurve,setActiveCurve] = useState('');
  const [details,setDetails] = useState(false);
  const [refresh,setRefresh] = useState(0);
  const [abc,setAbc] = useState(null);
  const [catalog,setCatalog] = useState(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');

  useEffect(()=>{
    const timer = setTimeout(()=>setDebouncedSearch(search.trim()),250);
    return ()=>clearTimeout(timer);
  },[search]);

  const catalogPlatform = platform==='TODAS'?'':platform;
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError('');
    const p=new URLSearchParams({platform,basis,days:String(days)});
    if(referenceMonth)p.set('month',referenceMonth);
    const cp=new URLSearchParams({limit:'1',offset:'0'});
    if(catalogPlatform)cp.set('marketplace',catalogPlatform);
    Promise.all([
      fetchJson('/api/admin/commerce/sales/abc/window?'+p),
      fetchJson('/api/admin/commerce/catalog/active-products?'+cp)
    ]).then(([a,b])=>{
      if(!cancelled){setAbc(a);setCatalog(b);}
    }).catch(e=>{if(!cancelled)setError(e.message||'Falha ao carregar o Painel Comercial.');})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[platform,basis,days,referenceMonth,refresh,salesRevision]);

  const classes=Array.isArray(abc?.classes)?abc.classes:[];
  const classMap=Object.fromEntries(classes.map(r=>[r.class,r]));
  const rankings=Array.isArray(abc?.items)?abc.items:[];
  const abcBySku=useMemo(()=>Object.fromEntries(rankings.map(r=>[String(r.sku_norm||'').toUpperCase(),r])),[abc]);
  const hasSnapshot=Boolean(abc?.has_snapshot);
  const hasSales=Boolean(abc?.has_sales);
  const reset=()=>{setSearch('');setPlatform('TODAS');setDays(30);setReferenceMonth('');setActiveCurve('');};
  const percentByCount=classes.map(x=>Number(x.products)||0);
  const countSum=percentByCount.reduce((a,b)=>a+b,0);
  const shares=countSum?percentByCount.map(x=>x/countSum*100):[0,0,0];
  const detailMessage = !hasSnapshot
    ? 'Não existem vendas importadas na base atual. Os anúncios permanecem visíveis abaixo.'
    : !hasSales ? 'Nenhuma venda registrada para os filtros selecionados.' : '';

  return <section className="nisti-com-dashboard">
    <header className="nisti-com-heading">
      <div className="nisti-com-symbol" aria-hidden="true">▣</div>
      <div>
        <h2>Painel Comercial</h2>
        <p>Produtos, anúncios e vendas</p>
      </div>
      <button className="nisti-com-light-button nisti-com-reload" type="button" onClick={()=>setRefresh(v=>v+1)}>Atualizar dados</button>
    </header>

    {error && <p role="alert" className="nisti-com-error">{error}</p>}
    <div className="nisti-com-global-filters" aria-label="Filtros universais">
      <label>Plataforma
        <select value={platform} onChange={e=>{setPlatform(e.target.value);setActiveCurve('');}}>
          {PLATFORM_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>Período
        <select value={days} onChange={e=>{setDays(Number(e.target.value));setActiveCurve('');}}>
          {[7,30,60,90].map(n=><option key={n} value={n}>Últimos {n} dias</option>)}
        </select>
      </label>
      <label>Referência
        <input type="month" value={referenceMonth} aria-label="Mês de referência"
          onChange={e=>{setReferenceMonth(e.target.value);setActiveCurve('');}}/>
      </label>
      <label className="nisti-com-global-search">Buscar no catálogo
        <input type="search" value={search}
          onChange={e=>{setSearch(e.target.value);setActiveCurve('');}} placeholder="SKU, produto ou ID"/>
      </label>
      <button className="nisti-com-light-button" type="button" onClick={reset}>Limpar</button>
      <small className="nisti-com-global-caption">As vendas e a Curva ABC seguem o período selecionado. Anúncios ativos refletem o catálogo atual.</small>
    </div>

    <div className="nisti-com-metrics">
      <Metric label="Anúncios ativos" value={catalog?number(catalog.active_ads):'—'}
        foot="Atuais" icon="▣" tone="pink"/>
      <Metric label="Grupos de produtos" value={catalog?number(catalog.total):'—'}
        foot="Agrupados" icon="◈" tone="gold"/>
      <Metric label="Unidades vendidas" value={hasSnapshot?number(abc.total_units):'—'}
        foot={hasSnapshot?days+' dias':'Sem importação'} icon="↗" tone="blue"/>
      <Metric label="Faturamento" value={hasSnapshot?money(abc.total_revenue):'—'}
        foot={hasSnapshot?days+' dias':'Sem importação'} icon="R$" tone="green"/>
    </div>

    <section className="nisti-com-section nisti-com-imports">
      <div className="nisti-com-section-heading">
        <h3>Importar arquivos</h3>
        <button type="button" className="nisti-com-light-button" aria-expanded={importOpen}
          onClick={()=>setImportOpen(v=>!v)}>{importOpen?'Fechar':'Selecionar planilha +'}</button>
      </div>
      {importOpen&&<CommerceImportCenter embedded
        onSalesChanged={()=>setRefresh(value=>value+1)}
        onCatalogChanged={()=>setRefresh(value=>value+1)} />}
    </section>

    <CommerceSalesVelocity platform={platform} days={days} month={referenceMonth} refresh={refresh+salesRevision}/>

    <section className="nisti-com-section nisti-com-abc">
      <div className="nisti-com-section-heading">
        <h3>Curva ABC de Vendas</h3>
        <div className="nisti-com-segment" aria-label="Critério da Curva ABC">
          <button type="button" className={basis==='REVENUE'?'selected':''} onClick={()=>{setBasis('REVENUE');setActiveCurve('');}}>Por faturamento</button>
          <button type="button" className={basis==='UNITS'?'selected':''} onClick={()=>{setBasis('UNITS');setActiveCurve('');}}>Por unidades</button>
        </div>
      </div>
      <div className="nisti-com-abc-cards">
        {CURVES.map(curve=>{
          const row=classMap[curve.code]||{};
          return <button type="button" key={curve.code}
            className={'nisti-com-abc-card class-'+curve.code.toLowerCase()+(activeCurve===curve.code?' active':'')}
            onClick={()=>setActiveCurve(v=>v===curve.code?'':curve.code)}
            aria-pressed={activeCurve===curve.code}>
            <span className="nisti-com-abc-flag">{curve.code}</span>
            <div><strong>{curve.title}</strong></div>
            <div className="nisti-com-abc-numbers">
              <span className="nisti-com-abc-donut" style={{'--abc-share':Math.max(0,Math.min(100,Number(row.percentage||0)))+'%'}}>
                <b>{hasSales?number(row.percentage)+'%':'—'}</b>
              </span>
              <div>
                <strong>{hasSales?number(row.products)+' produtos':'Aguardando vendas'}</strong>
                <b>{hasSales?basis==='UNITS'?number(row.units)+' un.':money(row.revenue):'—'}</b>
              </div>
            </div>
          </button>;
        })}
      </div>
      {detailMessage && <p className="nisti-com-data-note">{detailMessage}</p>}
      {activeCurve && (
        <CommerceAbcAdPerformance
          key={activeCurve}
          curve={activeCurve}
          platform={platform}
          basis={basis}
          days={days}
          month={referenceMonth}
          refresh={refresh+salesRevision}
          onShowInCatalog={sku=>{
            setSearch(sku);
            setActiveCurve('');
          }}
        />
      )}
    </section>

    <div className="nisti-com-analytics">
      <section className="nisti-com-section nisti-com-evolution">
        <div className="nisti-com-section-heading"><h3>Evolução de vendas</h3></div>
        <SalesHistoryChart history={abc?.history} basis={basis}/>
      </section>
      <section className="nisti-com-section nisti-com-participation">
        <h3>Distribuição da Curva ABC</h3>
        {hasSales?<div className="nisti-com-participation-inner">
          <div className="nisti-com-big-donut" style={{background:'conic-gradient(#27b47b 0% '+shares[0]+'%,#facb49 '+shares[0]+'% '+(shares[0]+shares[1])+'%,#fa566a '+(shares[0]+shares[1])+'% 100%)'}}>
            <span><b>{number(countSum)}</b><small>SKUs com vendas</small></span>
          </div>
          <div className="nisti-com-legend">
            {classes.map(x=><div key={x.class}><i className={'class-'+x.class.toLowerCase()}/><span>Curva {x.class}</span><strong>{number(x.products)}</strong></div>)}
          </div>
        </div>:<div className="nisti-com-placeholder">Distribuição disponível após importar vendas.</div>}
      </section>
    </div>

    <section className="nisti-com-section nisti-com-products">

      <div className="nisti-com-products-title">
        <h3>Produtos e anúncios</h3>
        {loading&&<small>Atualizando…</small>}
        {catalog&&<small>{number(catalog.active_ads)} anúncios ativos</small>}
      </div>

      <CommerceSkuListingsView key={salesRevision+'-'+refresh} catalogMode embedded
        externalSearch={debouncedSearch} externalPlatform={catalogPlatform}
        abcBySku={abcBySku}/>
    </section>

    <div className="nisti-com-deep-dive">
      <button type="button" onClick={()=>setDetails(v=>!v)} aria-expanded={details}>
        {details?'Ocultar análise detalhada':'Abrir análise detalhada de vendas'}
        <span aria-hidden="true">{details?'−':'+'}</span>
      </button>
      {details&&<div className="nisti-com-deep-dive-content">
        <CommerceSalesDashboard key={'detail-'+salesRevision+'-'+refresh}/>
      </div>}
    </div>
  </section>;
}
