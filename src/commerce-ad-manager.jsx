import React,{useEffect,useMemo,useRef,useState} from 'react';
import CommerceImportModal from './commerce-import-modal.jsx';
import {COMMERCE_IMPORT_OPTIONS} from './commerce-import-options.js';
import ShopeeUnlinkedSales from './commerce-shopee-unlinked-sales.jsx';
import CommerceSalesEvolution from './commerce-sales-evolution.jsx';
import CommerceTrafficMetrics from './commerce-traffic-metrics.jsx';
import CommerceShopeeAdsSummary from './commerce-shopee-ads-summary.jsx';
import CommerceShopeeAftercare from './commerce-shopee-aftercare.jsx';
import { fetchCommercialManager } from './commerce-manager-fetch.js';
import './commerce-ad-manager.css';
import './nisti-reactbits-adaptations.css';
import './commerce-approved-layout.css';
import './commerce-reactbits-lucide.css';
import './commerce-view-specific-kpis.css';
import './commerce-zero-sales-filters.css';
import GlareHover from './vendor/react-bits/GlareHover.jsx';
import CommercialIcon from './vendor/CommercialIcon.jsx';
import { listingSalesSituation } from './commerce-listing-classification.js';
import { identifiedVariationCoverage, listingLinkedSalesForPeriod, listingClassificationCoverage, listingPlatformSalesBreakdown, importedWindowDescription, shopeeMonthlyImportCoverage, shopeeSalesTotals } from './commerce-ad-evidence.js';

const API='/api/admin/commerce/listings/manager';
const PLATFORMS=[['TODAS','Todas as plataformas'],['ML_ANTIGO','Mercado Livre Antigo'],['ML_NOVO','Mercado Livre Novo'],['MERCADO_LIVRE','Todo Mercado Livre'],['SHOPEE','Shopee'],['AMAZON','Amazon'],['TIKTOK','TikTok Shop']];
const SALES_FILTERS=[['SOLD','Com vendas'],['ZERO','Sem vendas']];
const PERIODS=[7,30,60,90];
const periodLabel=(days,month)=>days===0?(month?'Mês '+month.split('-').reverse().join('/'):'Mês personalizado'):days+' dias';
const num=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));
const labelMonth=s=>/^\d{4}-\d{2}$/.test(String(s||''))?new Date(s+'-02T12:00:00').toLocaleDateString('pt-BR',{month:'short',year:'numeric'}):s;
const periodDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';
async function readJson(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:options.signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error||'Falha ao consultar o Gestor de Anúncios.');
  return data;
}
function PlatformLabel({item}){
  const source=item?.source||'';
  const name=PLATFORMS.find(p=>p[0]===source)?.[1]||item?.platform_name||source||'Não informado';
  return <span className="nim-platform"><span className={'nim-platform-icon '+(source.startsWith('ML_')?'ml':source.toLowerCase())} aria-hidden="true">
    {source.startsWith('ML_')?'ML':source==='SHOPEE'?'S':source==='AMAZON'?'a':source==='TIKTOK'?'T':'·'}
  </span><span>{name}</span></span>;
}
function Situation({item,days}){
  const linked=listingLinkedSalesForPeriod(item,days);
  const status=(!item.ready&&linked.hasSales)
    ?<span className="nim-status partial">Vendas identificadas</span>
    :item.source==='SHOPEE'&&!item.ready
      ?<span className="nim-status pending">Sem vendas identificadas</span>
      :listingSalesSituation(item)==='PENDING'
        ?<span className="nim-status pending">Dados pendentes</span>
        :listingSalesSituation(item)==='ZERO'
          ?<span className="nim-status zero">Sem vendas</span>
          :<span className="nim-status sold">Com vendas</span>;
  const trend=item.source==='SHOPEE'&&
    ['RISING','FALLING'].includes(item.identified_trend) &&
    Number.isFinite(Number(item.identified_growth_pct))?
      <small className={'nim-trend-hint '+(item.identified_trend==='RISING'?'up':'down')}
        title="Variação nas unidades vinculadas em janelas iguais; análise indicativa">
        {item.identified_trend==='RISING'?'↑ ':'↓ '}
        {Number(item.identified_growth_pct)>0?'+':''}
        {new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(item.identified_growth_pct))}%
      </small>:null;
  return <span className="nim-status-stack">{status}{trend}</span>;
}
function VariationSalesEvidence({item,days,partial}){
  if (!Number(item?.total_variations)) return null;
  if (partial) {
    const evidence=identifiedVariationCoverage(item,days);
    const empty=Number(item.identified_empty_variations||0);
    if (evidence.identified>0||empty>0)
      return <small className="nim-variation-identification">
        {num(evidence.identified)} com vendas identificadas
        {empty>0?' · '+num(empty)+' sem vendas identificadas':''}
      </small>;
    return <small className="nim-variation-awaiting">Vendas por variação sem vínculo confirmado</small>;
  }
  if (item.ready&&Number(item.zero_variations)>0)
    return <small>{num(item.zero_variations)} sem vendas</small>;
  if (!item.ready||!item.variation_data_complete)
    return <small className="nim-variation-awaiting">Vendas por variação pendentes</small>;
  return null;
}
function Kpi({label,value,description,tone,onClick,selected}){
  const icon={blue:'megaphone',mint:'shopping-cart',rose:'circle-alert',
    rising:'trending-up',falling:'trending-down',sand:'package',green:'shopping-cart'}[tone]||'package';
  const child=<GlareHover className="nim-kpi-glare" width="100%" height="100%"
    borderRadius="13px" glareColor="#b4d0ff" glareOpacity={0.13}
    glareSize={22} transitionDuration={420} rimGlint={false} playOnce={false}>
      <span className="nim-kpi-icon" aria-hidden="true"><CommercialIcon name={icon} size={21}/></span>
      <span className="nim-kpi-content">
        <small title={label}>{label}</small>
        <strong>{value}</strong>
        {description&&<span title={description}>{description}</span>}
      </span>
    </GlareHover>;
  return onClick?<button type="button" className={'nim-kpi '+tone+(selected?' selected':'')}
    aria-pressed={Boolean(selected)} onClick={onClick}>{child}</button>
    :<div className={'nim-kpi '+tone}>{child}</div>;
}
function MonthBars({months,basis}){
  const data=Array.isArray(months)?months:[];
  const values=data.map(m=>Number(basis==='UNITS'?m.units:m.revenue)||0);
  const max=Math.max(1,...values);
  if(!data.length)return <p className="nim-subtle">Ainda não há vendas mensais dos anúncios ativos nesta plataforma.</p>;
  return <div className="nim-month-bars" role="img" aria-label="Evolução mensal de vendas">
    {data.map((m,i)=><div key={m.period} className="nim-month-col"
      title={labelMonth(m.period)+' · '+num(m.units)+' unidades · '+money(m.revenue)}>
      <div className="nim-month-track"><div className="nim-month-bar" style={{height:(values[i]/max*100)+'%'}}/></div>
      <small>{m.period.slice(-2)+'/'+m.period.slice(2,4)}</small>
    </div>)}
  </div>;
}
const DETAIL_TABS=[['summary','Resumo'],['finance','Financeiro'],['variations','Variações'],['aftercare','Pós-venda']];

function DetailMetric({label,value,description}){
  return <div className="nim-detail-metric">
    <small>{label}</small><strong>{value}</strong>
    {description&&<span>{description}</span>}
  </div>;
}
function DetailRow({label,value,description}){
  return <div className="nim-detail-data-row">
    <div><span>{label}</span>{description&&<small>{description}</small>}</div>
    <strong>{value}</strong>
  </div>;
}
function ListingDetail({item,days,month,periodStart,periodEnd,importedThrough,zeroFilter,onClose,hasShopeeAds=false,initialTab='summary'}){
  const [months,setMonths]=useState(null);
  const [modelHistory,setModelHistory]=useState(null);
  const [error,setError]=useState('');
  const [showAll,setShowAll]=useState(false);
  const [activeTab,setActiveTab]=useState(initialTab);
  const [trafficOpen,setTrafficOpen]=useState(false);
  const [adsOverview,setAdsOverview]=useState({loading:false,items:[],error:''});
  const [aftercareOverview,setAftercareOverview]=useState(null);
  const [finance,setFinance]=useState(null);
  const [financeLoading,setFinanceLoading]=useState(false);
  const [financeError,setFinanceError]=useState('');
  const [ordersMetrics,setOrdersMetrics]=useState(null);
  const [ordersError,setOrdersError]=useState('');
  const [requestedDetailDays,setDetailDays]=useState(days);
  const detailDays=days===0?0:requestedDetailDays;
  const [periodResult,setPeriodResult]=useState(null);
  const [periodLoading,setPeriodLoading]=useState(false);
  const [periodError,setPeriodError]=useState('');
  useEffect(()=>{
    let cancelled=false;setMonths(null);setModelHistory(null);setError('');setShowAll(false);setTrafficOpen(false);
    readJson(API+'/'+encodeURIComponent(item.id)+'/months')
      .then(x=>{if(!cancelled){setMonths(x.months||[]);setModelHistory(x.model_history||null);}})
      .catch(e=>{if(!cancelled)setError(e.message);});
    return ()=>{cancelled=true;};
  },[item.id]);
  useEffect(()=>{
    if(detailDays===days){setPeriodError('');setPeriodLoading(false);return;}
    let cancelled=false;
    setPeriodResult(null);setPeriodError('');setPeriodLoading(true);
    const params=new URLSearchParams({
      platform:item.source||item.platform||'TODAS',
      days:String(detailDays),status:'ALL',curve:'ALL',basis:'REVENUE',
      search:String(item.external_listing_id||''),limit:'50',offset:'0'
    });
    if(detailDays===0 && month)params.set('month',month);
    readJson(API+'?'+params).then(data=>{
      if(cancelled)return;
      const found=Array.isArray(data?.items)?data.items.find(x=>String(x.id)===String(item.id)):null;
      if(!found)throw new Error('Não foi possível confirmar os dados deste anúncio no período.');
      setPeriodResult({days:detailDays,item:found,periodStart:data?.period_start,periodEnd:data?.period_end});
    }).catch(e=>{if(!cancelled)setPeriodError(e.message);})
      .finally(()=>{if(!cancelled)setPeriodLoading(false);});
    return ()=>{cancelled=true;};
  },[detailDays,days,month,item.id,item.source,item.platform,item.external_listing_id]);
  useEffect(()=>{
    if(!['finance','summary'].includes(activeTab)||item.source!=='SHOPEE')return;
    let cancelled=false;
    setFinance(null);setFinanceError('');setFinanceLoading(true);
    const params=new URLSearchParams({days:String(detailDays)});
    if(detailDays===0&&month)params.set('month',month);
    readJson(API+'/'+encodeURIComponent(item.id)+'/finance?'+params)
      .then(x=>{if(!cancelled)setFinance(x);})
      .catch(e=>{if(!cancelled)setFinanceError(e.message);})
      .finally(()=>{if(!cancelled)setFinanceLoading(false);});
    return ()=>{cancelled=true;};
  },[activeTab,item.id,item.source,detailDays,month]);

  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({
      platform:item.source||item.platform||'TODAS',days:String(detailDays)
    });
    if(detailDays===0&&month)params.set('month',month);
    setOrdersMetrics(null);setOrdersError('');
    readJson(API+'/'+encodeURIComponent(item.id)+'/orders?'+params,{signal:controller.signal})
      .then(x=>{if(!controller.signal.aborted)setOrdersMetrics(x);})
      .catch(e=>{if(!controller.signal.aborted)setOrdersError(e.message);});
    return ()=>controller.abort();
  },[item.id,item.source,item.platform,detailDays,month]);

  useEffect(()=>{
    if(activeTab!=='summary'||!hasShopeeAds||item.source!=='SHOPEE')return;
    const controller=new AbortController();
    setAdsOverview({loading:true,items:[],error:''});
    readJson(API+'/'+encodeURIComponent(item.id)+'/shopee-ads',{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setAdsOverview({
        loading:false,items:Array.isArray(result?.items)?result.items:[],error:''
      });})
      .catch(()=>{if(!controller.signal.aborted)setAdsOverview({
        loading:false,items:[],error:'Não foi possível consultar publicidade'
      });});
    return ()=>controller.abort();
  },[activeTab,item.id,item.source,hasShopeeAds]);

  useEffect(()=>{
    if(item.source!=='SHOPEE'||activeTab!=='summary')return;
    const ctrl=new AbortController();
    setAftercareOverview(null);
    readJson(API+'/'+encodeURIComponent(item.id)+'/aftercare',{signal:ctrl.signal})
      .then(data=>{if(!ctrl.signal.aborted)setAftercareOverview(data);})
      .catch(()=>{if(!ctrl.signal.aborted)setAftercareOverview(null);});
    return ()=>ctrl.abort();
  },[item.id,item.source,activeTab]);

  const detail=detailDays===days?item:
    periodResult?.days===detailDays?periodResult.item:null;
  const variations=Array.isArray(detail?.variations)?detail.variations:[];
  const relevant=zeroFilter&&!showAll?variations.filter(v=>v.units===0):variations;
  const complete=Boolean(detail?.ready&&detail?.variation_data_complete);
  const pending=!detail?.ready;
  const linkedEvidence=listingLinkedSalesForPeriod(detail,detailDays);
  const partialLinked=linkedEvidence.hasSales;
  const partialUnits=linkedEvidence.units;
  const partialRevenue=linkedEvidence.revenue;
  const selectedPeriodStart=detailDays===days?periodStart:periodResult?.periodStart;
  const selectedPeriodEnd=detailDays===days?periodEnd:periodResult?.periodEnd;
  const verifiedPeriod=selectedPeriodStart&&selectedPeriodEnd
    ?periodDate(selectedPeriodStart)+' a '+periodDate(selectedPeriodEnd):null;
  const variationEvidence=identifiedVariationCoverage(detail,detailDays);
  const partialVars=item.source==='SHOPEE'&&!complete?variationEvidence.variations:[];
  const partialRelevant=zeroFilter&&!showAll
    ?partialVars.filter(v=>v.units==null||Number(v.units)===0):partialVars;
  const partialEmptyCount=Number(detail?.identified_empty_variations||0);
  const historicalMonths=item.source==='SHOPEE'&&modelHistory?.has_versioned_model&&modelHistory?.months?.length
    ?modelHistory.months:months;
  const historicalByModel=item.source==='SHOPEE'&&Boolean(modelHistory?.has_versioned_model)&&Boolean(modelHistory?.months?.length);
  const trendPct=detail?.identified_growth_pct;
  const trendLabel=trendPct==null?'Sem base comparável':
    (Number(trendPct)>0?'+':'')+num(Number(trendPct))+'%';
  const latestAds=(adsOverview.items.find(row=>row.report_kind==='GENERAL')||adsOverview.items[0]||null);
  const detailTabs=hasShopeeAds&&item.source==='SHOPEE'
    ?[...DETAIL_TABS,['shopee_ads','Shopee Ads']]:DETAIL_TABS;
  return <aside className="nim-detail" aria-label={'Detalhes do anúncio '+item.external_listing_id}>
    <header className="nim-detail-header">
      <div className="nim-detail-title"><h3>{item.title}</h3>
        <div className="nim-detail-title-line"><PlatformLabel item={item}/>
          <span className="nim-detail-active">Anúncio ativo</span>
        </div>
      </div>
      <button type="button" className="nim-close" aria-label="Fechar detalhes" onClick={onClose}>×</button>
    </header>
    <div className="nim-detail-identity">
      <div><small>ID do anúncio</small><strong>{item.external_listing_id}</strong></div>
      <div><small>{item.curve_partial?'Curva ABC · indicativa':'Curva ABC'}</small>
        <strong>{item.curve||'—'}</strong></div>
    </div>
    <div className={'nim-detail-tab-list'+(hasShopeeAds&&item.source==='SHOPEE'?' has-shopee-ads':'')}
      role="tablist" aria-label="Informações do anúncio">
      {detailTabs.map(([code,label])=><button
        key={code} id={'nim-detail-tab-'+code} type="button" role="tab"
        aria-selected={activeTab===code} aria-controls={'nim-detail-panel-'+code}
        className={activeTab===code?'active':''} onClick={()=>setActiveTab(code)}>{label}</button>)}
    </div>
    <section className="nim-detail-tab-panel" role="tabpanel" id={'nim-detail-panel-'+activeTab}
      aria-labelledby={'nim-detail-tab-'+activeTab}>
      {activeTab==='shopee_ads'&&hasShopeeAds&&item.source==='SHOPEE'&&<>
        <CommerceShopeeAdsSummary listingId={item.id}/>
        <div className="nim-detail-traffic-collapsed">
          <button type="button" aria-expanded={trafficOpen}
            aria-controls="nim-detail-shopee-ads-traffic"
            onClick={()=>setTrafficOpen(open=>!open)}>
            Métricas adicionais de tráfego <span aria-hidden="true">{trafficOpen?'−':'+'}</span>
          </button>
          {trafficOpen&&<div id="nim-detail-shopee-ads-traffic">
            <p className="nim-detail-hint">Dados de outros relatórios por janela exata. Os anúncios CPC importados não informam visitas orgânicas e não são rateados por período.</p>
            <CommerceTrafficMetrics listingId={item.id} start={selectedPeriodStart} end={selectedPeriodEnd}/>
          </div>}
        </div>
      </>}
      {activeTab==='summary'&&<>
    <section className="nim-detail-performance" aria-label="Desempenho do anúncio">
      <div className="nim-detail-section-title nim-detail-performance-title">
        <h4>Desempenho</h4>
        {days===0?
          <span className="nim-detail-period-locked" aria-label="Período fixado pelo mês personalizado">
            Mês {month?month.split('-').reverse().join('/'):'personalizado'}
          </span>:
          <div className="nim-detail-periods" role="group" aria-label="Comparar períodos de vendas identificadas">
            {PERIODS.map(p=><button type="button" key={p} aria-pressed={detailDays===p}
              className={detailDays===p?'active':''} onClick={()=>setDetailDays(p)}>{p}d</button>)}
          </div>}
      </div>
      {days===0&&<p className="nim-detail-period-note">
        Esta ficha segue apenas {periodLabel(0,month)}. Para comparar 7, 30, 60 ou 90 dias,
        altere o período no filtro principal.
      </p>}
      {(verifiedPeriod||detailDays===0)&&<p className="nim-detail-period-note">
        {detailDays===0
          ?'Mês selecionado: '+(month||'personalizado')+
            (importedThrough?' · vendas importadas até '+periodDate(importedThrough):' · sem data final de importação confirmada')+
            '. O último dia do calendário não comprova cobertura do mês inteiro.'
          :'Vendas consultadas de '+verifiedPeriod+
            (detailDays!==days?' · período independente do filtro principal':'')+'.'}
      </p>}
      <div className="nim-detail-metrics">
        <DetailMetric label={item.source==='SHOPEE'&&!complete?'Unidades vinculadas':'Unidades vendidas'} value={partialLinked?num(partialUnits):pending?'—':num(detail.units)} description={periodLabel(detailDays,month)}/>
        <DetailMetric label={item.source==='SHOPEE'&&!complete?'Faturamento vinculado':'Faturamento'} value={partialLinked?money(partialRevenue):pending?'—':money(detail.revenue)} description={periodLabel(detailDays,month)+' · produtos'}/>
        {item.source==='SHOPEE'&&detailDays!==0?
          <DetailMetric label="Tendência identificada" value={trendLabel}
            description="Comparação com igual período anterior · vendas vinculadas"/>:
          <DetailMetric label="Pedidos com item" value={ordersMetrics?.listing?.order_item_incidents==null?'—':num(ordersMetrics.listing.order_item_incidents)}
            description="Ocorrências de pedido com produto vinculado; pedidos com vários SKUs podem contar mais de uma vez"/>}
        <DetailMetric label="Receita por pedido com item" value={ordersMetrics?.listing?.reference_per_item_order==null?'—':money(ordersMetrics.listing.reference_per_item_order)}
          description="Referência por ocorrência de pedido com item, não ticket médio exato do anúncio"/>
      </div>
      {ordersError&&<p className="nim-detail-pending nim-detail-period-error" role="alert">Não foi possível consultar pedidos: {ordersError}</p>}
      {periodLoading&&<p className="nim-detail-pending" role="status">Consultando dados: {periodLabel(detailDays,month)}…</p>}
      {periodError&&<p className="nim-detail-pending nim-detail-period-error" role="alert">{periodError}</p>}
      {pending&&!partialLinked&&!periodLoading&&!periodError&&<p className="nim-detail-pending">Dados de vendas ainda não consolidados para {periodLabel(detailDays,month)}. Valores desconhecidos não são zero.</p>}
      {partialLinked&&!complete&&<p className="nim-detail-pending">Valores associados a este anúncio por SKU nos relatórios disponíveis. Outros registros podem permanecer sem associação.</p>}
    </section>
        <div className="nim-detail-overview" aria-label="Resumo das ferramentas do anúncio">
          <button type="button" className="nim-detail-overview-item"
            onClick={()=>setActiveTab('finance')} aria-label="Abrir detalhes financeiros">
            <span>Financeiro <b aria-hidden="true">↗</b></span>
            <strong>{partialLinked?money(partialRevenue):pending?'—':money(detail?.revenue)}</strong>
            <small>{item.source==='SHOPEE'&&finance?.has_finance_data
              ?'Subtotal bruto · taxas disponíveis em Financeiro'
              :item.source==='SHOPEE'&&financeLoading?'Subtotal bruto · conferindo taxas'
              :'Subtotal dos produtos · taxas não conciliadas'}</small>
          </button>
          <button type="button" className="nim-detail-overview-item"
            onClick={()=>setActiveTab('variations')} aria-label="Abrir detalhes das variações">
            <span>Variações <b aria-hidden="true">↗</b></span>
            <strong>{num(item.total_variations)} cadastradas</strong>
            <small>{complete
              ?num(detail?.sold_variations)+' com vendas · '+num(detail?.zero_variations)+' sem vendas'
              :num(variationEvidence.identified)+' com vendas identificadas · vínculo parcial'}</small>
          </button>
          <button type="button" className="nim-detail-overview-item"
            onClick={()=>setActiveTab('aftercare')} aria-label="Abrir detalhes de pós-venda">
            <span>Pós-venda <b aria-hidden="true">↗</b></span>
            <strong>{item.source==='SHOPEE'&&Number(aftercareOverview?.counts?.requests)>0
              ?num(aftercareOverview.counts.requests)+' solicitações':'Sem relatório vinculado'}</strong>
            <small>{item.source==='SHOPEE'&&Number(aftercareOverview?.counts?.requests)>0
              ?num(aftercareOverview.counts.approved)+' aprovadas · '+num(aftercareOverview.counts.withdrawn)+' retiradas pelo comprador'
              :'Cancelamentos de pedidos e estornos pagos não confirmados'}</small>
          </button>
          {hasShopeeAds&&item.source==='SHOPEE'&&<button type="button"
            className="nim-detail-overview-item" onClick={()=>setActiveTab('shopee_ads')}
            aria-label="Abrir métricas de Shopee Ads">
            <span>Shopee Ads <b aria-hidden="true">↗</b></span>
            <strong>{adsOverview.loading?'Consultando…':latestAds?.clicks==null?'—':num(latestAds.clicks)+' cliques'}</strong>
            <small>{latestAds?.ctr_pct!=null
              ?'CTR '+new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(latestAds.ctr_pct))+
                '% · período '+periodDate(latestAds.start)+' a '+periodDate(latestAds.end)
              :adsOverview.error||'Publicidade acumulada · período do relatório'}</small>
          </button>}
        </div>
        <details className="nim-detail-history">
          <summary>Histórico mensal de vendas <span aria-hidden="true">▾</span></summary>
          <div className="nim-detail-history-body">
        <div className="nim-detail-section-title"><h4>Evolução de vendas</h4>
          <small>{historicalByModel?'Histórico mensal do modelo':'Histórico mensal das vendas identificadas'}</small></div>
        {error?<p className="nim-error" role="alert">{error}</p>:months===null?
          <p className="nim-subtle">Consultando histórico…</p>:<MonthBars months={historicalMonths} basis="REVENUE"/>}
        {historicalByModel?<p className="nim-detail-hint">
          Histórico automático pelo código do modelo, incluindo SKUs antigos e atualizados importados.
          É um agrupamento de vendas do produto, não prova que todos os pedidos vieram deste ID de anúncio.
          Nenhum SKU precisa ser associado manualmente.
        </p>:months?.some(m=>m.partial)&&<p className="nim-detail-hint">
          Histórico das vendas identificadas. Outras vendas do produto podem estar fora do anúncio atual.
        </p>}
        {historicalMonths?.length>0&&<div className="nim-month-values">
          {historicalMonths.slice(-6).reverse().map(m=><div key={m.period}>
            <span>{labelMonth(m.period)}</span><strong>{num(m.units)} un. · {money(m.revenue)}</strong>
          </div>)}
        </div>}
        {!complete&&item.total_variations>0&&
          <p className="nim-subtle">{variationEvidence.identified>0
            ?num(variationEvidence.identified)+' de '+num(item.total_variations)+' variações com unidades identificadas. Consulte a aba Variações para ver cada quantidade.'
            :'Ainda não há vendas individuais vinculadas com segurança para este período; a ausência de vínculo não significa zero vendas.'}</p>}

          </div>
        </details>
        {!(hasShopeeAds&&item.source==='SHOPEE')&&<div className="nim-detail-traffic-collapsed">
          <button type="button" aria-expanded={trafficOpen}
            aria-controls="nim-detail-traffic-metrics"
            onClick={()=>setTrafficOpen(open=>!open)}>
            Métricas de tráfego <span aria-hidden="true">{trafficOpen?'−':'+'}</span>
          </button>
          {trafficOpen&&<div id="nim-detail-traffic-metrics">
            <CommerceTrafficMetrics listingId={item.id}
              start={selectedPeriodStart} end={selectedPeriodEnd}/>
          </div>}
        </div>}
      </>}
      {activeTab==='finance'&&<>
        <div className="nim-detail-section-title"><h4>Resultado financeiro</h4><small>{periodLabel(detailDays,month)}</small></div>
        <div className="nim-detail-data-list">
          <DetailRow label="Subtotal dos produtos" value={partialLinked?money(partialRevenue):pending?'—':money(detail.revenue)}
            description={partialLinked?'Subtotal das vendas vinculadas por SKU · não necessariamente o total':'Receita dos produtos no período selecionado'}/>
          {item.source==='SHOPEE'&&finance?.has_finance_data&&<>
            <DetailRow label="Subtotal com taxas verificadas" value={money(finance.fee_reconciled_subtotal)}
              description={num(finance.orders_with_verified_fees)+' pedidos de SKU único com taxas informadas'}/>
            <DetailRow label="Descontos do vendedor" value={money(finance.seller_discount_already_in_subtotal)}
              description="Informativos: já refletidos no subtotal, não descontados novamente"/>
            <DetailRow label="Comissões Shopee (líquidas)" value={money(finance.commission_net)}/>
            <DetailRow label="Taxas de serviço (líquidas)" value={money(finance.service_net)}/>
            <DetailRow label="Taxa de transação" value={money(finance.transaction_fee)}/>
            <DetailRow label="Após taxas identificadas · estimativa" value={money(finance.after_identified_fees)}
              description="Somente pedidos com taxas verificadas e um único SKU"/>
          </>}
          {item.source!=='SHOPEE'&&<>
            <DetailRow label="Descontos do vendedor" value="—"/>
            <DetailRow label="Comissões da plataforma" value="—"/>
            <DetailRow label="Taxas de serviço" value="—"/>
            <DetailRow label="Receita após taxas identificadas" value="—"/>
          </>}
        </div>
        {item.source==='SHOPEE'&&financeLoading&&<p className="nim-detail-hint" role="status">Conferindo taxas do relatório Shopee…</p>}
        {item.source==='SHOPEE'&&financeError&&<p className="nim-detail-hint" role="alert">{financeError}</p>}
        {item.source==='SHOPEE'&&!financeLoading&&!financeError&&!finance?.has_finance_data&&
          <p className="nim-detail-hint">As vendas e os SKUs foram importados, mas as taxas não foram preservadas nas importações anteriores. Reimporte o Excel original da Shopee após a atualização do importador para conciliar comissões e descontos sem alterar o histórico de produtos.</p>}
        {item.source==='SHOPEE'&&finance?.has_finance_data&&<p className="nim-detail-hint">
          Valores financeiros verificados apenas em pedidos com um único SKU. Comissões repetidas nas linhas do Excel são contadas uma vez por pedido; pedidos com vários SKUs não têm taxas rateadas artificialmente. Descontos do vendedor já podem estar incluídos no preço do produto. O resultado é uma estimativa após taxas identificadas, não o repasse oficial nem lucro líquido.
        </p>}
        {item.source!=='SHOPEE'&&<p className="nim-detail-hint">Descontos e taxas não foram conciliados por anúncio. O subtotal não representa repasse ou lucro líquido.</p>}
      </>}
      {activeTab==='variations'&&<>
        <div className="nim-detail-section-title">
          <h4>Desempenho por variação</h4><small>{num(item.total_variations)} variações</small>
        </div>
        {item.total_variations===0&&<p className="nim-subtle">Anúncio sem variações cadastradas.</p>}
        {item.total_variations>0&&!complete&&
          <p className="nim-advice">As variações deste anúncio ainda precisam de conciliação de SKU ou de cobertura do período; zeros não são presumidos.</p>}
        {!complete&&partialVars.length>0&&<p className="nim-var-totals">
          {num(variationEvidence.identified)+' variações com vendas identificadas · '+
            num(partialEmptyCount)+' sem vendas identificadas'}
          {Number(detail?.identifiable_variations||0)<Number(item.total_variations)&&
            ' · '+num(Number(item.total_variations)-Number(detail?.identifiable_variations||0))+' sem SKU exclusivo'}
        </p>}
        {item.total_variations>0&&complete&&
          <p className="nim-var-totals">{num(detail.sold_variations)} com vendas · {num(detail.zero_variations)} sem vendas</p>}
        {zeroFilter&&item.total_variations>0&&
          <label className="nim-var-toggle"><input type="checkbox" checked={showAll}
            onChange={e=>setShowAll(e.target.checked)}/> Mostrar todas as variações</label>}
        {!complete&&partialVars.length>0&&<div className="nim-detail-table-scroll">
          <table><thead><tr><th>Variação / SKU</th><th>Unid. vinculadas</th><th>Receita vinculada</th></tr></thead>
            <tbody>{partialRelevant.map((v,i)=><tr key={String(v.id||i)}>
              <td><strong>{v.name}</strong><small>{v.sku||'SKU não informado'}</small></td>
              <td>{v.units==null?'Não identificada':num(v.units)}</td>
              <td>{v.revenue==null?'—':money(v.revenue)}</td>
            </tr>)}</tbody>
          </table>
          {partialRelevant.length===0&&<p className="nim-subtle">Nenhuma variação sem vendas identificadas neste anúncio.</p>}
        </div>}
        {relevant.length>0&&<div className="nim-detail-table-scroll">
          <table><thead><tr><th>Variação / SKU</th><th>Unid.</th><th>Receita</th></tr></thead>
            <tbody>{relevant.map((v,i)=><tr key={String(v.id||v.sku||i)} className={v.units===0?'nim-var-zero':''}>
              <td><strong>{v.name}</strong><small>{v.sku||'SKU não informado'}</small></td>
              <td>{v.units==null?'—':num(v.units)}</td>
              <td>{v.revenue==null?'—':money(v.revenue)}</td>
            </tr>)}</tbody>
          </table>
          {!relevant.length&&<p className="nim-subtle">Nenhuma variação sem vendas neste anúncio.</p>}
        </div>}
        {item.total_variations>0&&!relevant.length&&partialVars.length===0&&
          <p className="nim-subtle">{complete?'Nenhuma variação corresponde ao filtro selecionado.':
            'Os nomes das variações estarão disponíveis aqui quando o vínculo entre SKU e anúncio for confirmado.'}</p>}
      </>}
      {activeTab==='aftercare'&&<>
        {item.source==='SHOPEE'?<CommerceShopeeAftercare listingId={item.id}/>:<>
        <div className="nim-detail-section-title"><h4>Pós-venda e logística</h4><small>{periodLabel(detailDays,month)}</small></div>
        <div className="nim-detail-data-list">
          <DetailRow label="Cancelamentos confirmados" value="Não importado"
            description="As planilhas de vendas atuais descartam pedidos cancelados, sem registrar eventos de pós-venda"/>
          <DetailRow label="Devoluções confirmadas" value="Não importado"
            description="Não há relatórios de devolução registrados nesta plataforma"/>
          <DetailRow label="Reembolsos realizados" value="Não importado"
            description="Solicitação de reembolso não comprova pagamento do estorno"/>
          <DetailRow label="Taxa de cancelamento" value="—"
            description="Exige total de pedidos e cancelamentos do mesmo período"/>
          <DetailRow label="Prazo de envio / entrega" value="Não importado"/>
          <DetailRow label="Região compradora" value="Não importado"/>
        </div>
        <p className="nim-detail-hint">Cobertura de pós-venda indisponível nesta importação.
          Não exibimos zero para cancelamentos ou devoluções sem relatório dos eventos reais,
          nem inferimos reembolsos a partir de status genéricos.</p>
        </>}
      </>}
    </section>
    <footer className="nim-detail-buttons">
      {item.url&&<a href={item.url} target="_blank" rel="noopener noreferrer">Ver no marketplace ↗</a>}
      <button type="button" onClick={()=>navigator.clipboard?.writeText?.(item.external_listing_id)}>Copiar ID</button>
    </footer>
  </aside>;
}
export default function CommerceCommercialDashboard({salesRevision=0}){
  const [platform,setPlatform]=useState('TODAS');
  const [days,setDays]=useState(30);
  const [month,setMonth]=useState('');
  const [query,setQuery]=useState('');
  const [search,setSearch]=useState('');
  const [status,setStatus]=useState('ALL');
  const [curve,setCurve]=useState('ALL');
  const [basis,setBasis]=useState('REVENUE');
  const [offset,setOffset]=useState(0);
  const [size,setSize]=useState(20);
  const [refresh,setRefresh]=useState(0);
  const [selectedId,setSelectedId]=useState(null);
  const [selectedTab,setSelectedTab]=useState('summary');
  const [adsCoverage,setAdsCoverage]=useState({state:'idle',listingIds:[]});
  const [data,setData]=useState(null);
  const lastSuccessfulRequest=useRef(null);
  const [monthly,setMonthly]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [importMenuOpen,setImportMenuOpen]=useState(false);
  const [selectedImportMode,setSelectedImportMode]=useState(null);
  const importMenuRef=useRef(null);
  const importTriggerRef=useRef(null);
  const [monthlyOpen,setMonthlyOpen]=useState(false);
  const [commercialView,setCommercialView]=useState('LISTINGS');
  const [financialOpen,setFinancialOpen]=useState(false);
  const [importedTotals,setImportedTotals]=useState(null);
  const [importedTotalsError,setImportedTotalsError]=useState('');
  const [evolutionStatus,setEvolutionStatus]=useState('ALL');
  const [evolutionSummary,setEvolutionSummary]=useState(null);
  useEffect(()=>{
    if(!importMenuOpen)return;
    function handleOutside(event){
      if(!importMenuRef.current?.contains(event.target))setImportMenuOpen(false);
    }
    function handleEscape(event){
      if(event.key==='Escape'){
        setImportMenuOpen(false);
        importTriggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown',handleOutside);
    document.addEventListener('keydown',handleEscape);
    return ()=>{
      document.removeEventListener('pointerdown',handleOutside);
      document.removeEventListener('keydown',handleEscape);
    };
  },[importMenuOpen]);
  const openImportType=mode=>{
    if(!COMMERCE_IMPORT_OPTIONS.some(option=>option.mode===mode))return;
    setImportMenuOpen(false);
    setSelectedImportMode(mode);
  };
  useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),320);return ()=>clearTimeout(timer);},[query]);
  useEffect(()=>{setOffset(0);setSelectedId(null);},[platform,days,month,search,status,curve,basis,size]);
  useEffect(()=>{
    let cancelled=false;const controller=new AbortController();
    setLoading(true);setError('');
    const params=new URLSearchParams({platform,days:String(days),status,curve,basis,
      limit:String(size),offset:String(offset)});
    if(days===0 && month)params.set('month',month);
    if(search)params.set('search',search);
    const requestKey=params.toString();
    // Never display results from a different filter while a new request is pending.
    // On refresh of the SAME filters, keep the last successful data visible.
    const matchingPrevious=lastSuccessfulRequest.current===requestKey;
    if(!matchingPrevious)setData(null);
    if(days===0&&!month){
      lastSuccessfulRequest.current=null;
      setData(null);setLoading(false);
      return ()=>{cancelled=true;controller.abort();};
    }
    fetchCommercialManager(API+'?'+params,{signal:controller.signal})
      .then(x=>{if(!cancelled){lastSuccessfulRequest.current=requestKey;setData(x);}})
      .catch(e=>{if(!cancelled)setError(e.message);})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;controller.abort();};
  },[platform,days,month,search,status,curve,basis,size,offset,refresh,salesRevision]);
  useEffect(()=>{
    let cancelled=false;setMonthly(null);
    readJson(API+'/monthly?platform='+encodeURIComponent(platform))
      .then(x=>{if(!cancelled)setMonthly(x);})
      .catch(()=>{if(!cancelled)setMonthly({months:[]});});
    return ()=>{cancelled=true;};
  },[platform,refresh,salesRevision]);

  // Total geral permanece disponível sob demanda, fora dos 5 cartões operacionais.
  useEffect(()=>{
    const controller=new AbortController();
    setImportedTotals(null);setImportedTotalsError('');
    if(!financialOpen||!data?.period_start||!data?.period_end)return ()=>controller.abort();
    const params=new URLSearchParams({
      platform,start:data.period_start,end:data.period_end,monthly:days===0?'1':'0'
    });
    readJson(API+'/imported-totals?'+params,{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setImportedTotals(result);})
      .catch(err=>{if(!controller.signal.aborted)setImportedTotalsError(err.message);});
    return ()=>controller.abort();
  },[financialOpen,data?.period_start,data?.period_end,platform,days,refresh,salesRevision]);

  const kpi=data?.kpis||{};
  const hasMonthPartial=data?.source_kind==='MONTHLY_SKU_PARTIAL';
  const hasDailyPartial=data?.source_kind==='DAILY_SKU_PARTIAL';
  const hasMixedPartial=data?.source_kind==='MIXED_LISTING_SKU_PARTIAL';
  const hasShopeePartial=hasMonthPartial||hasDailyPartial||hasMixedPartial||platform==='SHOPEE';
  const classified=hasMixedPartial
    ?listingPlatformSalesBreakdown(kpi,days,data?.source_kind)
    :listingClassificationCoverage(kpi,days);
  const sourceBreakdown=hasShopeePartial
    ?listingPlatformSalesBreakdown(kpi,days,data?.source_kind):null;
  const monthCoverage=shopeeMonthlyImportCoverage(data);
  const coverageText=monthCoverage?new Intl.NumberFormat('pt-BR',
    {minimumFractionDigits:2,maximumFractionDigits:2}).format(monthCoverage.percentage)+'%':null;
  const partialAds=sourceBreakdown?.identified??0;
  const shopeeTotals=shopeeSalesTotals(data,days);
  const importedMonthTotal=Boolean(shopeeTotals?.hasImportedTotal);
  const fullImportedAvailable=importedTotals?.available===true
    &&importedTotals.units!=null&&importedTotals.revenue!=null;
  const linkedSalesDescription=hasMixedPartial
    ?(importedMonthTotal
      ?num(shopeeTotals.verifiedUnits)+' unidades por ID no Mercado Livre + '+
        num(shopeeTotals.linkedUnits)+' identificadas na Shopee; total bruto importado exibido'
      :'Mercado Livre por ID de anúncio + Shopee por SKU identificado; dados parciais')
    :importedMonthTotal
      ?num(shopeeTotals.linkedUnits)+' de '+num(shopeeTotals.units)+' unidades vinculadas aos anúncios'
      :'Somente vendas vinculadas por SKU · total da plataforma não confirmado nesta janela';
  const salesCoverageLabel=Number(kpi.pending_ads||0)>0
    ?periodLabel(days,month)+' · dados parciais':periodLabel(days,month)+' · anúncios ativos';
  const hasReliableSales=data&&Number(kpi.covered_ads||0)>0;
  // This KPI counts listings only; variation-level gaps belong in the
  // expanded listing and must never inflate the count of unsold ads.
  const emptyIdentifiedAds=sourceBreakdown?.withoutIdentified??0;
  const emptyIdentifiedVars=Number(kpi.identified_empty_variations||0);
  // The two views must not share status filters or mix listing counts with SKUs.
  // Evolution summary comes from the same paginated RPC response as the results.
  const evolutionCounts=evolutionSummary?.kpis||null;
  const evolutionReady=Boolean(evolutionCounts)
    &&['falling','zero','sold','rising'].every(key=>
      evolutionCounts[key]!=null&&Number.isFinite(Number(evolutionCounts[key])));
  const evolutionCount=key=>evolutionReady?num(evolutionCounts[key]):'—';
  const chooseEvolutionStatus=next=>{
    if(!evolutionReady)return;
    setEvolutionStatus(current=>current===next?'ALL':next);
  };
  const trendSelected=['RISING','FALLING'].includes(status)?status:'ALL';
  const shopeeTrendAvailable=platform==='SHOPEE'&&days!==0;
  // No sale means no units recorded for a fully checked listing in the
  // imported window, never "no SKU owner found". Unknowns stay outside both.
  const noSalesStatus='ZERO';
  const noSalesLabel='Sem vendas';
  const noSalesValue=kpi.zero_ads;
  const changeNoSales=()=>change(setStatus,status==='ZERO'?'ALL':'ZERO');
  const rows=Array.isArray(data?.items)?data.items:[];
  useEffect(()=>{
    const controller=new AbortController();
    const shopeeIds=(Array.isArray(data?.items)?data.items:[])
      .filter(item=>item.source==='SHOPEE'&&Number.isSafeInteger(Number(item.id))&&Number(item.id)>0)
      .map(item=>Number(item.id));
    setAdsCoverage({state:shopeeIds.length?'loading':'ready',listingIds:[]});
    if(!shopeeIds.length)return ()=>controller.abort();
    readJson(API+'/shopee-ads/coverage?ids='+shopeeIds.join(','),{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setAdsCoverage({
        state:'ready',listingIds:Array.isArray(result?.listing_ids)?result.listing_ids:[]
      });})
      .catch(()=>{if(!controller.signal.aborted)setAdsCoverage({state:'error',listingIds:[]});});
    return ()=>controller.abort();
  },[data?.items]);
  const hasShopeeAds=id=>adsCoverage.state==='ready'&&adsCoverage.listingIds.includes(Number(id));
  const openListing=(id,tab='summary')=>{setSelectedTab(tab);setSelectedId(id);};
  const total=Number(data?.total||0);
  const pages=Math.max(1,Math.ceil(total/size));
  const page=Math.floor(offset/size)+1;
  const selected=useMemo(()=>rows.find(x=>x.id===selectedId)||null,[rows,selectedId]);
  const clear=()=>{setPlatform('TODAS');setDays(30);setMonth('');setQuery('');setSearch('');
    setStatus('ALL');setCurve('ALL');setBasis('REVENUE');setOffset(0);setSelectedId(null);};
  const change=(setter,value)=>{setter(value);setOffset(0);setSelectedId(null);};
  return <section className="nim-manager">
    <header className="nim-heading">
      <div><h2>Gestor de Anúncios</h2><p>Anúncios ativos, vendas e desempenho por plataforma</p></div>
      <div className="nim-header-actions">
        <button type="button" className="nim-soft-button" onClick={()=>setRefresh(v=>v+1)}>
          <CommercialIcon name="refresh-cw" size={16}/> Atualizar</button>
        <div className="nim-import-dropdown" ref={importMenuRef}>
          <button type="button" className="nim-primary-button" ref={importTriggerRef}
            onClick={()=>setImportMenuOpen(open=>!open)} aria-haspopup="menu"
            aria-controls="nim-import-options" aria-expanded={importMenuOpen}>
            <CommercialIcon name="upload" size={16}/> Importar arquivo
            <span className="nim-import-trigger-arrow" aria-hidden="true">▾</span>
          </button>
          {importMenuOpen&&<div id="nim-import-options" className="nim-import-options"
            role="menu" aria-label="Escolher tipo de relatório">
            {COMMERCE_IMPORT_OPTIONS.map(option=><button type="button" role="menuitem"
              key={option.mode} onClick={()=>openImportType(option.mode)}>
              <span className="nim-import-option-icon" aria-hidden="true">
                <CommercialIcon name={option.icon} size={18}/>
              </span>
              <span className="nim-import-option-copy">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              <span className="nim-import-option-arrow" aria-hidden="true">›</span>
            </button>)}
          </div>}
        </div>
      </div>
    </header>
    {selectedImportMode&&<CommerceImportModal mode={selectedImportMode}
      returnFocusRef={importTriggerRef}
      onClose={()=>setSelectedImportMode(null)}
      onChooseAnother={()=>{setSelectedImportMode(null);setImportMenuOpen(true);}}
      onSalesChanged={()=>setRefresh(v=>v+1)}
      onCatalogChanged={()=>setRefresh(v=>v+1)}/>}

    {commercialView==='LISTINGS'?
      <div className="nim-kpis nim-kpis-listings" aria-label="Indicadores de anúncios">
        <Kpi tone="blue" label="Anúncios ativos" value={data?num(kpi.active_ads):'—'}
          description="Anúncios monitorados"/>
        <Kpi tone="mint" label="Com vendas"
          value={data?num(Number(kpi.sold_ads||0)+(hasShopeePartial
            ?Math.max(0,Number(kpi.identified_ads||0)-
              Number(kpi.shopee_covered_sold_ads||0)):0)):'—'}
          description={hasShopeePartial?'Vendas por SKU nos dados importados':'Vendas registradas no período'}
          selected={status==='SOLD'}
          onClick={()=>change(setStatus,status==='SOLD'?'ALL':'SOLD')}/>
        <Kpi tone="rose" label={noSalesLabel}
          value={data?(platform==='SHOPEE'&&days===0?'—':num(noSalesValue)):'—'}
          description={days===0&&platform==='SHOPEE'?'Selecione 7, 30, 60 ou 90 dias':
            'Nenhuma venda registrada na janela importada · SKUs conferidos'}
          selected={status===noSalesStatus}
          onClick={platform==='SHOPEE'&&days===0?undefined:changeNoSales}/>
      </div>:
      <div className="nim-kpis nim-kpis-evolution" aria-label="Filtros por situação na Evolução de Vendas">
        <Kpi tone="falling" label="Em queda" value={evolutionCount('falling')}
          description="SKU/modelos com queda confirmada" selected={evolutionStatus==='FALLING'}
          onClick={evolutionReady?()=>chooseEvolutionStatus('FALLING'):undefined}/>
        <Kpi tone="rose" label="Sem vendas" value={evolutionCount('zero')}
          description="SKU/modelos sem vendas e com cobertura completa"
          selected={evolutionStatus==='ZERO'}
          onClick={evolutionReady?()=>chooseEvolutionStatus('ZERO'):undefined}/>
        <Kpi tone="mint" label="Com vendas" value={evolutionCount('sold')}
          description="SKU/modelos com unidades identificadas"
          selected={evolutionStatus==='SOLD'}
          onClick={evolutionReady?()=>chooseEvolutionStatus('SOLD'):undefined}/>
        <Kpi tone="rising" label="Crescimento" value={evolutionCount('rising')}
          description="SKU/modelos com crescimento confirmado"
          selected={evolutionStatus==='RISING'}
          onClick={evolutionReady?()=>chooseEvolutionStatus('RISING'):undefined}/>
      </div>}
    <nav className="nim-commercial-views" aria-label="Visões do Painel Comercial">
      <button type="button" className={commercialView==='LISTINGS'?'active':''}
        aria-current={commercialView==='LISTINGS'?'page':undefined}
        onClick={()=>{setCommercialView('LISTINGS');setEvolutionSummary(null);}}><CommercialIcon name="layout-list" size={16}/> Anúncios</button>
      <button type="button" className={commercialView==='EVOLUTION'?'active':''}
        aria-current={commercialView==='EVOLUTION'?'page':undefined}
        onClick={()=>{setEvolutionSummary(null);setCommercialView('EVOLUTION');}}>
        <CommercialIcon name="chart-no-axes-column-increasing" size={16}/> Evolução de vendas</button>
    </nav>
    {commercialView==='LISTINGS'&&<section className="nim-finance-disclosure" aria-label="Conciliação de vendas importadas">
      <button type="button" className="nim-finance-toggle" aria-expanded={financialOpen}
        onClick={()=>setFinancialOpen(previous=>!previous)}>
        <span>Totais financeiros importados</span>
        <span aria-hidden="true">{financialOpen?'−':'+'}</span>
      </button>
      {financialOpen&&<div className="nim-finance-body">
        <p className="nim-finance-note">Valores importados, inclusive produtos sem anúncio ativo. Totais vinculados a anúncios podem ser parciais.</p>
        <div className="nim-finance-metrics">
          <Kpi tone="sand" label={fullImportedAvailable?'Unidades vendidas':hasShopeePartial?'Unidades identificadas':'Unidades vendidas'}
            value={fullImportedAvailable?num(importedTotals.units):
              shopeeTotals?.units!=null?num(shopeeTotals.units):hasReliableSales?num(kpi.units):'—'}
            description={fullImportedAvailable?'Todas as unidades importadas no período, inclusive sem anúncio ativo':
              hasShopeePartial?linkedSalesDescription:salesCoverageLabel}/>
          <Kpi tone="green" label={fullImportedAvailable?'Faturamento bruto importado':hasShopeePartial?'Faturamento identificado':'Faturamento'}
            value={fullImportedAvailable?money(importedTotals.revenue):
              shopeeTotals?.revenue!=null?money(shopeeTotals.revenue):hasReliableSales?money(kpi.revenue):'—'}
            description={fullImportedAvailable?'Total dos produtos vendidos, com e sem vínculo de anúncio':
              hasShopeePartial?linkedSalesDescription:salesCoverageLabel}/>
        </div>
        {importedTotalsError&&<p className="nim-coverage" role="status">
          Totais completos não disponíveis nesta consulta; exibindo somente dados identificados.
        </p>}
      </div>}
    </section>}
    {commercialView==='EVOLUTION'?
      <CommerceSalesEvolution platform={platform} onPlatformChange={setPlatform}
        initialDays={PERIODS.includes(days)?days:30} onPeriodChange={setDays}
        status={evolutionStatus} onStatusChange={setEvolutionStatus}
        onSummary={setEvolutionSummary} revision={refresh} salesRevision={salesRevision}/>:
      <>
    <section className="nim-filter-panel" aria-label="Filtros de plataforma, anúncio, período, situação de vendas e Curva ABC">
      <div className="nim-filter-top">
        <label className="nim-filter-field nim-filter-platform">Plataforma
          <select value={platform} onChange={e=>{
            const next=e.target.value;
            if(next==='SHOPEE')setCurve('ALL');
            if(['RISING','FALLING','UNLINKED','VAR_ZERO'].includes(status) ||
              (days===0&&next==='SHOPEE'&&status==='ZERO'))setStatus('ALL');
            change(setPlatform,next);
          }}>
            {PLATFORMS.map(([id,name])=><option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="nim-filter-field nim-filter-search">Buscar anúncio ou ID
          <input type="search" value={query} onChange={e=>setQuery(e.target.value)}
            placeholder="Nome ou ID do anúncio" maxLength={150}/>
        </label>
        <div className="nim-filter-period-group">
          <label className="nim-filter-field nim-filter-period">Período
            <select value={days===0?'MONTH':String(days)}
              onChange={e=>{
                const choice=e.target.value;
                if(choice!=='MONTH')setMonth('');
                if(platform==='SHOPEE'){
                  setCurve('ALL');
                  // Shopee without a confirmed listing link is never proven zero.
                }
                if(choice==='MONTH'&&(['RISING','FALLING','VAR_ZERO','UNLINKED'].includes(status)
                  ||(platform==='SHOPEE'&&status==='ZERO')))setStatus('ALL');
                change(setDays,choice==='MONTH'?0:Number(choice));
              }}>
              {PERIODS.map(n=><option key={n} value={n}>
                {n} dias · janela importada
              </option>)}
              <option value="MONTH">Personalizado · escolher mês</option>
            </select>
          </label>
          {days===0&&<label className="nim-filter-field nim-filter-custom-month">Mês personalizado
            <input type="month" value={month} max={new Date().toISOString().slice(0,7)}
              onChange={e=>change(setMonth,e.target.value)}
              aria-label="Selecionar mês para análise personalizada"/>
          </label>}
        </div>
        <button type="button" className="nim-soft-button nim-filter-reset" onClick={clear}>Limpar filtros</button>
      </div>
      <div className={'nim-filter-panel-body'+(shopeeTrendAvailable?' nim-has-trend':'')}>
        <div className="nim-filter-group nim-performance-group">
          <span className="nim-filter-group-label">Situação de vendas</span>
          <div className="nim-status-tabs" role="group" aria-label="Filtrar anúncios por situação de vendas">
            {SALES_FILTERS.map(([code,label])=><button type="button" key={code}
              onClick={()=>change(setStatus,status===code?'ALL':code)}
              title={code==='ZERO'?'Sem unidades registradas na janela completa de vendas importadas e com SKU conferido':undefined}
              disabled={code==='ZERO'&&days===0&&platform==='SHOPEE'}
              className={status===code?'active':''} aria-pressed={status===code}>
              {label}
            </button>)}
          </div>
        </div>
        <div className="nim-filter-group nim-abc-group">
          <span className="nim-filter-group-label">Curva ABC{hasShopeePartial?' · indicativa':''}</span>
          <div className="nim-abc-controls">
            <div className="nim-curve-tabs" role="group" aria-label="Filtrar anúncios por Curva ABC">
              {['ALL','A','B','C'].map(code=><button type="button" key={code}
                className={curve===code?'active':''} aria-pressed={curve===code}
                onClick={()=>change(setCurve,code)}
                title={hasShopeePartial&&code!=='ALL'?'Ranking provisório apenas das vendas identificadas, sem assumir vendas zero':undefined}>{code==='ALL'?'Todas':code}</button>)}
            </div>
            <label className="nim-abc-basis-label">
              <span>Classificar por</span>
              <select aria-label="Critério ABC" value={basis} onChange={e=>change(setBasis,e.target.value)}>
                <option value="REVENUE">Faturamento</option><option value="UNITS">Unidades vendidas</option>
              </select>
            </label>
          </div>
        </div>
        {shopeeTrendAvailable&&<label className="nim-filter-group nim-trend-group">
          <span className="nim-filter-group-label">Tendência identificada</span>
          <select aria-label="Filtrar anúncios por tendência identificada" value={trendSelected}
            title="Substitui o filtro de situação de vendas. Base: ao menos 3 unidades anteriores."
            onChange={e=>change(setStatus,e.target.value)}>
            <option value="ALL">Todas as tendências</option>
            <option value="RISING">Em alta ({data?num(kpi.growing_identified_ads):'—'})</option>
            <option value="FALLING">Em queda ({data?num(kpi.falling_identified_ads):'—'})</option>
          </select>
        </label>}
      </div>
      <div className="nim-filter-panel-footer">
        <span className="nim-coverage">
          {days===0&&!month?'Selecione o mês no período personalizado.':
            importedWindowDescription(data,days,periodDate)}
        </span>
        {hasShopeePartial&&data?hasMixedPartial?<>
          <span className="nim-filter-panel-identified">{num(classified.identified)} anúncios com vendas identificadas ({num(sourceBreakdown.marketplaceWithSales)} ML + {num(sourceBreakdown.shopeeWithSales)} Shopee)</span>
          <span className="nim-filter-panel-unclassified"
            title="São anúncios sem vendas identificadas pelos SKUs conhecidos nas planilhas importadas do período; não são SKUs sem vínculo. Pedidos não importados ou códigos antigos ainda desconhecidos podem existir.">
            {num(sourceBreakdown.marketplaceWithoutSales)} anúncios ML sem vendas no período ·
            {sourceBreakdown.marketplacePending>0?' '+num(sourceBreakdown.marketplacePending)+' ML sem cobertura de vendas no período · ':' '}
            {num(sourceBreakdown.shopeeWithoutLink)} anúncios Shopee sem vendas identificadas por SKU no período
          </span>
        </>:<>
          <span className="nim-filter-panel-identified">{num(classified.identified)} anúncios com vendas identificadas</span>
          <span className="nim-filter-panel-unclassified"
            title="A contagem é de anúncios sem vendas identificadas pelos SKUs conhecidos no período selecionado, não de SKUs faltando. Não comprova ausência de pedidos fora dos arquivos importados.">
            {num(classified.unclassified)} anúncios sem vendas identificadas por SKU no período
          </span>
        </>:Number(kpi.pending_ads)>0&&<span className="nim-filter-panel-warning">{num(kpi.pending_ads)} anúncio(s) com dados pendentes</span>}
        {status==='ZERO'&&<span className="nim-filter-panel-note">
          Anúncios sem unidades registradas de {periodDate(data?.period_start)} a {periodDate(data?.period_end)}
          nos relatórios importados, com SKU/variações conferidos. Se um vínculo estiver ambíguo,
          ele não será classificado como zero.
        </span>}
        {['RISING','FALLING'].includes(status)&&<span className="nim-filter-panel-note">
          Comparação com período anterior de mesma duração · variação de 20% ou mais · mínimo de 3 unidades anteriores · dados parciais
        </span>}
      </div>
    </section>
    {days===0&&data?.imported_month&&!search&&<section className="nim-imported-month-summary" aria-label="Totais de vendas importadas da plataforma">
      <div><strong>Vendas importadas · {periodLabel(days,month)}</strong>
        <p>Totais {platform==='TODAS'?'das plataformas selecionadas':'da plataforma '+(PLATFORMS.find(p=>p[0]===platform)?.[1]||platform)}; não correspondem necessariamente aos anúncios atualmente ativos.</p></div>
      <div className="nim-imported-month-stats">
        <span><small>Pedidos</small><strong>{num(data.imported_month.orders)}</strong></span>
        <span><small>Unidades</small><strong>{num(data.imported_month.units)}</strong></span>
        <span><small>Subtotal dos produtos</small><strong>{money(data.imported_month.revenue)}</strong></span>
      </div>
      <p className="nim-imported-month-warning">{monthCoverage
        ?'Cobertura do mês: '+coverageText+' das unidades importadas com SKU vinculado a anúncio ativo ('+
          num(monthCoverage.matchedUnits)+' de '+num(monthCoverage.importedUnits)+'). '+
          (monthCoverage.remainingUnits>0
            ?num(monthCoverage.remainingUnits)+' unidade(s), '+money(monthCoverage.remainingRevenue)+
              ', sem anúncio ativo correspondente. '
            :'Todas as unidades do mês foram vinculadas. ')+
          'Importação até '+periodDate(monthCoverage.importedThrough)+
          '. A cobertura global não comprova ausência de vendas em cada variação.'
        :hasMonthPartial
          ?'Vendas identificadas por SKU exclusivo: '+num(kpi.month_linked_units)+
            ' unidades. Não confundir ausência de vínculo com zero vendas.'
          :'Sem vínculos diários confiáveis por anúncio, as quantidades individuais e a Curva ABC permanecem pendentes.'}</p>
    </section>}
    {days===0&&month&&!data?.imported_month&&!loading&&!error&&<p className="nim-no-imported-month">
      Nenhuma venda mensal importada para {periodLabel(days,month)} na plataforma selecionada.
    </p>}
    {error&&<div className="nim-error" role="alert">{error}
      {data&&<small>Exibindo o último resultado confirmado para estes filtros.</small>}
      <button type="button" onClick={()=>setRefresh(v=>v+1)}>Tentar novamente</button></div>}
    <div className={'nim-content '+(selected?'has-detail':'')}>
      <section className="nim-list-panel">
        <div className="nim-list-header">
          <div><h3>Lista de anúncios</h3><small>{loading?'Consultando anúncios…':num(total)+' anúncios encontrados'}</small></div>
          <div className="nim-list-actions">
            <button type="button" className="nim-soft-button" onClick={()=>setMonthlyOpen(v=>!v)}
              aria-expanded={monthlyOpen}>{monthlyOpen?'Ocultar evolução mensal':'Analisar vendas mensais'} <span aria-hidden="true">{monthlyOpen?'−':'↗'}</span></button>
          </div>
        </div>
        {monthlyOpen&&<div className="nim-month-summary">
          <h4>Evolução mensal · anúncios atualmente ativos</h4>
          <MonthBars months={monthly?.months} basis={basis}/>
          {monthly?.months?.some(m=>m.partial)&&<p className="nim-detail-hint">Somente vendas identificadas por SKU exclusivo, sem ratear pedidos entre anúncios. Totais parciais.</p>}
        </div>}
        <div className="nim-table-scroll">
          <table className="nim-ad-table" aria-label="Anúncios ativos e desempenho"><thead><tr>
            <th>Plataforma</th><th>Nome e ID do anúncio</th><th>{hasMixedPartial?'Unid. identificadas':hasShopeePartial?'Unid. vinculadas':'Unid.'} {periodLabel(days,month)}</th>
            <th>Variações</th><th>{hasMixedPartial?'Faturamento identificado':hasShopeePartial?'Faturamento vinculado':'Faturamento'}</th><th>ABC</th><th>Vendas</th>
          </tr></thead><tbody>
            {!loading&&rows.map((item,index)=>{
              const linked=listingLinkedSalesForPeriod(item,days);
              return <tr key={item.id} data-nim-row style={{'--nim-order':Math.min(index,6)}} className={selectedId===item.id?'selected':''}
              onClick={()=>openListing(item.id)} title="Abrir detalhes do anúncio">
              <td data-label="Plataforma"><PlatformLabel item={item}/></td>
              <td data-label="Anúncio"><strong className="nim-ad-name">{item.title}</strong>
                <small className="nim-ad-id">{item.external_listing_id}</small>
                <button type="button" className="nim-row-open" aria-label={'Abrir detalhes do anúncio '+item.external_listing_id}
                  onClick={event=>{event.stopPropagation();openListing(item.id);}}>Ver detalhes →</button>
                 {item.source==='SHOPEE'&&hasShopeeAds(item.id)&&<button type="button"
                   className="nim-row-ads" aria-label={'Consultar Shopee Ads do anúncio '+item.external_listing_id}
                   onClick={event=>{event.stopPropagation();openListing(item.id,'shopee_ads');}}>
                   Shopee Ads ↗</button>}</td>
              <td data-label="Unidades" className="nim-units">{item.ready?num(item.units):linked.hasSales?num(linked.units):'—'}</td>
              <td data-label="Variações"><span className="nim-variations-cell">{item.total_variations?num(item.total_variations)+' variações':'Sem variações'}
                <VariationSalesEvidence item={item} days={days}
                  partial={hasShopeePartial&&item.source==='SHOPEE'&&!item.ready}/>
              </span></td>
              <td data-label="Faturamento" className="nim-money">{item.ready?money(item.revenue):linked.hasSales?money(linked.revenue):'—'}</td>
              <td data-label="Curva ABC">{item.curve?<span className={'nim-curve badge-'+item.curve.toLowerCase()}
                title={item.curve_partial?'ABC indicativa: calculada apenas com vendas identificadas':'Curva ABC por vendas consolidadas'}>{item.curve}{item.curve_partial?'*':''}</span>:'—'}</td>
              <td data-label="Situação"><Situation item={item} days={days}/></td>
            </tr>;
            })}
            {loading&&<tr><td colSpan={7} className="nim-table-empty">Carregando anúncios…</td></tr>}
            {!loading&&!error&&rows.length===0&&<tr><td colSpan={7} className="nim-table-empty">
              {status==='ZERO'?'Nenhum anúncio com zero vendas registradas e SKU conferido nesta janela.':
                'Nenhum anúncio encontrado para o filtro.'}</td></tr>}
          </tbody></table>
        </div>
        <footer className="nim-list-footer">
          <label><select value={size} onChange={e=>change(setSize,Number(e.target.value))} aria-label="Anúncios por página">
            {[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}</select> por página</label>
          <span>Página {page} de {pages} · {num(total)} anúncios</span>
          <div><button type="button" disabled={loading||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-size))}>Anterior</button>
            <button type="button" disabled={loading||offset+size>=total} onClick={()=>setOffset(v=>v+size)}>Próxima</button></div>
        </footer>
      </section>
      {selected&&<ListingDetail key={[selected.id,days,month,selectedTab].join(':')}
        item={selected} days={days} month={month}
        hasShopeeAds={hasShopeeAds(selected.id)} initialTab={selectedTab==='shopee_ads'&&hasShopeeAds(selected.id)?'shopee_ads':'summary'}
        periodStart={data?.period_start} periodEnd={data?.period_end}
        importedThrough={data?.imported_month?.period_end||data?.data_through}
        zeroFilter={false} onClose={()=>setSelectedId(null)}/>}
    </div>
    {platform==='SHOPEE'&&(days!==0||Boolean(month))&&
      ['ALL','SOLD'].includes(status)&&curve==='ALL'&&
      <ShopeeUnlinkedSales days={days} month={month}
        importedThrough={data?.imported_month?.period_end}
        search={search} revision={refresh} salesRevision={salesRevision}/>}
    </>}
    <p className="nim-footnote">
      Com vendas e Sem vendas são calculados por anúncio na janela importada; o detalhamento de
      cada variação permanece na ficha do anúncio. Ausência de venda significa ausência de unidades
      registradas nos arquivos importados, e não comprovação independente de todos os pedidos.
      SKUs compartilhados entre anúncios sem vínculo exclusivo não são marcados automaticamente como zero.
      {Number(kpi.shopee_unclassified_ads||0)>0&&
        ' '+num(kpi.shopee_unclassified_ads)+' anúncio(s) Shopee aguardam conciliação de SKU.'}
    </p>
  </section>;
}
