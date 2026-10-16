import React, { useEffect, useMemo, useState } from 'react';
import CommerceSkuListingsView from './commerce-sku-listings-view.jsx';
import CommerceSalesDashboard from './commerce-sales-dashboard.jsx';
import CommerceAbcAdPerformance from './commerce-abc-ad-performance.jsx';
import './commerce-commercial-dashboard.css';

const PLATFORM_OPTIONS = [
  ['TODAS','Todas as plataformas'],
  ['MERCADO_LIVRE','Mercado Livre'],
  ['SHOPEE','Shopee'],
  ['AMAZON','Amazon']
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
  const [periodStart,setPeriodStart] = useState('');
  const [periodEnd,setPeriodEnd] = useState('');
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
    const p=new URLSearchParams({platform,basis});
    if(periodStart)p.set('period_start',periodStart);
    if(periodEnd)p.set('period_end',periodEnd);
    const cp=new URLSearchParams({limit:'1',offset:'0'});
    if(catalogPlatform)cp.set('marketplace',catalogPlatform);
    Promise.all([
      fetchJson('/api/admin/commerce/sales/abc?'+p),
      fetchJson('/api/admin/commerce/catalog/active-products?'+cp)
    ]).then(([a,b])=>{
      if(!cancelled){setAbc(a);setCatalog(b);}
    }).catch(e=>{if(!cancelled)setError(e.message||'Falha ao carregar o Painel Comercial.');})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[platform,basis,periodStart,periodEnd,refresh,salesRevision]);

  const classes=Array.isArray(abc?.classes)?abc.classes:[];
  const classMap=Object.fromEntries(classes.map(r=>[r.class,r]));
  const rankings=Array.isArray(abc?.items)?abc.items:[];
  const abcBySku=useMemo(()=>Object.fromEntries(rankings.map(r=>[String(r.sku_norm||'').toUpperCase(),r])),[abc]);
  const periods=Array.isArray(abc?.periods)?abc.periods:[];
  const hasSnapshot=Boolean(abc?.has_snapshot);
  const hasSales=Boolean(abc?.has_sales);
  const reset=()=>{setSearch('');setPlatform('TODAS');setPeriodStart('');setPeriodEnd('');setActiveCurve('');};
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
        <p>Catálogo + Vendas em um só lugar</p>
      </div>
      <button className="nisti-com-light-button nisti-com-reload" type="button" onClick={()=>setRefresh(v=>v+1)}>Atualizar dados</button>
    </header>

    {error && <p role="alert" className="nisti-com-error">{error}</p>}

    <div className="nisti-com-metrics">
      <Metric label="Anúncios ativos" value={catalog?number(catalog.active_ads):'—'}
        foot="Independente da sincronização" icon="▣" tone="pink"/>
      <Metric label="Grupos de produtos" value={catalog?number(catalog.total):'—'}
        foot="Anúncios repetidos agrupados" icon="◈" tone="gold"/>
      <Metric label="Unidades vendidas" value={hasSnapshot?number(abc.total_units):'—'}
        foot={hasSnapshot?'Período selecionado':'Aguardando importação'} icon="↗" tone="blue"/>
      <Metric label="Faturamento" value={hasSnapshot?money(abc.total_revenue):'—'}
        foot={hasSnapshot?'Pedidos: '+number(abc.net_orders):'Aguardando importação'} icon="R$" tone="green"/>
    </div>

    <section className="nisti-com-section nisti-com-abc">
      <div className="nisti-com-section-heading">
        <div><h3>Curva ABC de Vendas</h3><p>Classificação por contribuição acumulada no período</p></div>
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
            <div><strong>{curve.title}</strong><small>{curve.subtitle}</small></div>
            <div className="nisti-com-abc-numbers">
              <span className="nisti-com-abc-donut" style={{'--abc-share':Math.max(0,Math.min(100,Number(row.percentage||0)))+'%'}}>
                <b>{hasSales?number(row.percentage)+'%':'—'}</b>
              </span>
              <div>
                <strong>{hasSales?number(row.products)+' produtos':'Aguardando vendas'}</strong>
                <b>{hasSales?basis==='UNITS'?number(row.units)+' un.':money(row.revenue):'—'}</b>
                <small>{curve.cutoff}</small>
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
          periodStart={periodStart}
          periodEnd={periodEnd}
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
        <div className="nisti-com-section-heading"><div><h3>Evolução de vendas</h3><p>{basis==='UNITS'?'Unidades vendidas':'Faturamento'} por mês</p></div></div>
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
      <div className="nisti-com-products-filters">
        <label className="nisti-com-search-label"><span>Buscar produto, SKU ou ID</span>
          <input type="search" value={search} onChange={e=>{setSearch(e.target.value);setActiveCurve('');}}
            placeholder="Buscar produto, SKU ou ID do anúncio..." />
        </label>
        <label>Plataforma
          <select value={platform} onChange={e=>{setPlatform(e.target.value);setActiveCurve('');}}>
            {PLATFORM_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>De
          <select value={periodStart} onChange={e=>setPeriodStart(e.target.value)}>
            <option value="">Todo o histórico</option>
            {periods.map(p=><option key={p} value={p}>{monthLabel(p)}</option>)}
          </select>
        </label>
        <label>Até
          <select value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)}>
            <option value="">Último disponível</option>
            {periods.map(p=><option key={p} value={p}>{monthLabel(p)}</option>)}
          </select>
        </label>
        <button className="nisti-com-light-button" type="button" onClick={reset}>Limpar filtros</button>
      </div>

      <div className="nisti-com-products-title">
        <div><h3>Produtos e anúncios</h3>
          <p>Todos os anúncios ativos, mesmo sem vínculo com o Scanner.</p></div>
        {loading&&<small>Atualizando…</small>}
        {catalog&&<small>{number(catalog.active_ads)} anúncios ativos</small>}
      </div>

      <CommerceSkuListingsView key={salesRevision} catalogMode embedded
        externalSearch={debouncedSearch} externalPlatform={catalogPlatform}
        abcBySku={abcBySku}/>
    </section>

    <div className="nisti-com-deep-dive">
      <button type="button" onClick={()=>setDetails(v=>!v)} aria-expanded={details}>
        {details?'Ocultar análise detalhada':'Abrir análise detalhada de vendas'}
        <span aria-hidden="true">{details?'−':'+'}</span>
      </button>
      {details&&<div className="nisti-com-deep-dive-content">
        <p>Histórico, filtros de vendas, exportação e registros manuais por anúncio continuam disponíveis nesta mesma ferramenta.</p>
        <CommerceSalesDashboard key={'detail-'+salesRevision}/>
      </div>}
    </div>
  </section>;
}
