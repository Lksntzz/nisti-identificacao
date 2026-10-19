import React,{useEffect,useMemo,useRef,useState} from 'react';
import CommerceImportCenter from './commerce-import-center.jsx';
import ShopeeUnlinkedSales from './commerce-shopee-unlinked-sales.jsx';
import { fetchCommercialManager } from './commerce-manager-fetch.js';
import './commerce-ad-manager.css';
import { listingSalesSituation } from './commerce-listing-classification.js';
import { identifiedVariationCoverage, listingClassificationCoverage, importedWindowDescription, shopeeMonthlyImportCoverage, shopeeSalesTotals } from './commerce-ad-evidence.js';

const API='/api/admin/commerce/listings/manager';
const PLATFORMS=[['TODAS','Todas as plataformas'],['ML_ANTIGO','Mercado Livre Antigo'],['ML_NOVO','Mercado Livre Novo'],['MERCADO_LIVRE','Todo Mercado Livre'],['SHOPEE','Shopee'],['AMAZON','Amazon'],['TIKTOK','TikTok Shop']];
const SALES_FILTERS=[['ALL','Todos'],['SOLD','Com vendas'],['ZERO','Sem vendas']];
const PERIODS=[7,30,60,90];
const periodLabel=(days,month)=>days===0?(month?'Mês '+month.split('-').reverse().join('/'):'Mês personalizado'):days+' dias';
const num=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));
const labelMonth=s=>/^\d{4}-\d{2}$/.test(String(s||''))?new Date(s+'-02T12:00:00').toLocaleDateString('pt-BR',{month:'short',year:'numeric'}):s;
const periodDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';
async function readJson(url){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
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
function Situation({item}){
  const status=(!item.ready&&(Number(item.month_linked_units)>0||Number(item.identified_units)>0))
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
  const child=<><small>{label}</small><strong>{value}</strong>{description&&<span>{description}</span>}</>;
  return onClick?<button type="button" className={'nim-kpi '+tone+(selected?' selected':'')} onClick={onClick}>{child}</button>
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
function ListingDetail({item,days,month,zeroFilter,onClose}){
  const [months,setMonths]=useState(null);
  const [modelHistory,setModelHistory]=useState(null);
  const [error,setError]=useState('');
  const [showAll,setShowAll]=useState(false);
  const [activeTab,setActiveTab]=useState('summary');
  const [finance,setFinance]=useState(null);
  const [financeLoading,setFinanceLoading]=useState(false);
  const [financeError,setFinanceError]=useState('');
  const [requestedDetailDays,setDetailDays]=useState(days);
  const detailDays=days===0?0:requestedDetailDays;
  const [periodResult,setPeriodResult]=useState(null);
  const [periodLoading,setPeriodLoading]=useState(false);
  const [periodError,setPeriodError]=useState('');
  useEffect(()=>{
    let cancelled=false;setMonths(null);setModelHistory(null);setError('');setShowAll(false);
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
      setPeriodResult({days:detailDays,item:found});
    }).catch(e=>{if(!cancelled)setPeriodError(e.message);})
      .finally(()=>{if(!cancelled)setPeriodLoading(false);});
    return ()=>{cancelled=true;};
  },[detailDays,days,month,item.id,item.source,item.platform,item.external_listing_id]);
  useEffect(()=>{
    if(activeTab!=='finance'||item.source!=='SHOPEE')return;
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

  const detail=detailDays===days?item:
    periodResult?.days===detailDays?periodResult.item:null;
  const variations=Array.isArray(detail?.variations)?detail.variations:[];
  const relevant=zeroFilter&&!showAll?variations.filter(v=>v.units===0):variations;
  const complete=Boolean(detail?.ready&&detail?.variation_data_complete);
  const pending=!detail?.ready;
  const monthLinked=detailDays===0&&Number(detail?.month_linked_units)>0;
  const dailyLinked=detailDays!==0&&Number(detail?.identified_units)>0;
  const partialLinked=monthLinked||dailyLinked;
  const partialUnits=monthLinked?detail?.month_linked_units:detail?.identified_units;
  const partialRevenue=monthLinked?detail?.month_linked_revenue:detail?.identified_revenue;
  const variationEvidence=identifiedVariationCoverage(detail,detailDays);
  const partialVars=item.source==='SHOPEE'&&!complete?variationEvidence.variations:[];
  const partialRelevant=zeroFilter&&!showAll
    ?partialVars.filter(v=>v.units==null||Number(v.units)===0):partialVars;
  const partialEmptyCount=Number(detail?.identified_empty_variations||0);
  const historicalMonths=item.source==='SHOPEE'&&modelHistory?.months?.length
    ?modelHistory.months:months;
  const historicalByModel=item.source==='SHOPEE'&&Boolean(modelHistory?.months?.length);
  const trendPct=detail?.identified_growth_pct;
  const trendLabel=trendPct==null?'Sem base comparável':
    (Number(trendPct)>0?'+':'')+num(Number(trendPct))+'%';
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
      <div className="nim-detail-metrics">
        <DetailMetric label={item.source==='SHOPEE'&&!complete?'Unidades vinculadas':'Unidades vendidas'} value={partialLinked?num(partialUnits):pending?'—':num(detail.units)} description={periodLabel(detailDays,month)}/>
        <DetailMetric label={item.source==='SHOPEE'&&!complete?'Faturamento vinculado':'Faturamento'} value={partialLinked?money(partialRevenue):pending?'—':money(detail.revenue)} description={periodLabel(detailDays,month)+' · produtos'}/>
        {item.source==='SHOPEE'&&detailDays!==0?
          <DetailMetric label="Tendência identificada" value={trendLabel}
            description="Comparação com igual período anterior · vendas vinculadas"/>:
          <DetailMetric label="Pedidos" value="—" description="Aguardando vínculo por anúncio"/>}
        <DetailMetric label="Ticket médio" value="—" description="Aguardando pedidos identificados"/>
      </div>
      {periodLoading&&<p className="nim-detail-pending" role="status">Consultando dados: {periodLabel(detailDays,month)}…</p>}
      {periodError&&<p className="nim-detail-pending nim-detail-period-error" role="alert">{periodError}</p>}
      {pending&&!partialLinked&&!periodLoading&&!periodError&&<p className="nim-detail-pending">Dados de vendas ainda não consolidados para {periodLabel(detailDays,month)}. Valores desconhecidos não são zero.</p>}
      {partialLinked&&<p className="nim-detail-pending">Valores comprovadamente vinculados a este anúncio. Outros registros históricos podem permanecer sem associação; esse subtotal não comprova o faturamento total.</p>}
    </section>
    <div className="nim-detail-tab-list" role="tablist" aria-label="Informações do anúncio">
      {DETAIL_TABS.map(([code,label])=><button
        key={code} id={'nim-detail-tab-'+code} type="button" role="tab"
        aria-selected={activeTab===code} aria-controls={'nim-detail-panel-'+code}
        className={activeTab===code?'active':''} onClick={()=>setActiveTab(code)}>{label}</button>)}
    </div>
    <section className="nim-detail-tab-panel" role="tabpanel" id={'nim-detail-panel-'+activeTab}
      aria-labelledby={'nim-detail-tab-'+activeTab}>
      {activeTab==='summary'&&<>
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
        <div className="nim-detail-summary-footer">
          <div><strong>Variações cadastradas</strong>
            <span>{num(item.total_variations)} variações</span></div>
          <button type="button" onClick={()=>setActiveTab('variations')}>Ver variações →</button>
        </div>
        {!complete&&item.total_variations>0&&
          <p className="nim-subtle">{variationEvidence.identified>0
            ?num(variationEvidence.identified)+' de '+num(item.total_variations)+' variações com unidades identificadas. Consulte a aba Variações para ver cada quantidade.'
            :'Ainda não há vendas individuais vinculadas com segurança para este período; a ausência de vínculo não significa zero vendas.'}</p>}
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
          <p className="nim-advice">Quantidades e receitas identificadas por SKU exclusivo são parciais; não mostramos zeros presumidos. Variações sem vendas identificadas podem ter vendas ainda não vinculadas.</p>}
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
        <div className="nim-detail-section-title"><h4>Pós-venda e logística</h4><small>{periodLabel(detailDays,month)}</small></div>
        <div className="nim-detail-data-list">
          <DetailRow label="Pedidos cancelados" value="—"/>
          <DetailRow label="Devoluções e reembolsos" value="—"/>
          <DetailRow label="Taxa de cancelamento" value="—"/>
          <DetailRow label="Prazo médio de envio" value="—"/>
          <DetailRow label="Principal região compradora" value="—"/>
        </div>
        <p className="nim-detail-hint">Indicadores indisponíveis até a conciliação dos pedidos e dos eventos pós-venda por anúncio. Solicitações de reembolso não são tratadas como estorno confirmado.</p>
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
  const [data,setData]=useState(null);
  const lastSuccessfulRequest=useRef(null);
  const [monthly,setMonthly]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [importOpen,setImportOpen]=useState(false);
  const [monthlyOpen,setMonthlyOpen]=useState(false);
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
  const kpi=data?.kpis||{};
  const hasMonthPartial=data?.source_kind==='MONTHLY_SKU_PARTIAL';
  const hasDailyPartial=data?.source_kind==='DAILY_SKU_PARTIAL';
  const hasShopeePartial=hasMonthPartial||hasDailyPartial||platform==='SHOPEE';
  const classified=listingClassificationCoverage(kpi,days);
  const monthCoverage=shopeeMonthlyImportCoverage(data);
  const coverageText=monthCoverage?new Intl.NumberFormat('pt-BR',
    {minimumFractionDigits:2,maximumFractionDigits:2}).format(monthCoverage.percentage)+'%':null;
  const partialAds=hasMonthPartial?Number(kpi.month_linked_ads||0):Number(kpi.identified_ads||0);
  const shopeeTotals=shopeeSalesTotals(data,days);
  const importedMonthTotal=Boolean(shopeeTotals?.hasImportedTotal);
  const linkedSalesDescription=importedMonthTotal
    ?num(shopeeTotals.linkedUnits)+' de '+num(shopeeTotals.units)+' unidades vinculadas aos anúncios'
    :'Somente vendas vinculadas por SKU · total da plataforma não confirmado nesta janela';
  const hasReliableSales=data&&Number(kpi.covered_ads||0)>0;
  const emptyIdentifiedAds=Number(kpi.identified_empty_ads||0);
  const emptyIdentifiedVars=Number(kpi.identified_empty_variations||0);
  const trendSelected=['RISING','FALLING'].includes(status)?status:'ALL';
  const shopeeTrendAvailable=platform==='SHOPEE'&&days!==0;
  const salesCoverageLabel=Number(kpi.pending_ads||0)>0
    ?periodLabel(days,month)+' · dados parciais':periodLabel(days,month)+' · anúncios ativos';
  const rows=Array.isArray(data?.items)?data.items:[];
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
        <button type="button" className="nim-soft-button" onClick={()=>setRefresh(v=>v+1)}>↻ Atualizar</button>
        <button type="button" className="nim-primary-button" onClick={()=>setImportOpen(v=>!v)}
          aria-expanded={importOpen}>{importOpen?'Fechar importação':'↑ Importar arquivos'}</button>
      </div>
    </header>
    {importOpen&&<div className="nim-import-panel"><CommerceImportCenter embedded
      onSalesChanged={()=>setRefresh(v=>v+1)}
      onCatalogChanged={()=>setRefresh(v=>v+1)}/></div>}
    <div className="nim-kpis">
      <Kpi tone="blue" label="Anúncios ativos" value={data?num(kpi.active_ads):'—'} description="Por plataforma"/>
      <Kpi tone="mint" label={hasShopeePartial?'Com vendas identificadas':'Com vendas'} value={hasShopeePartial&&data?num(partialAds):hasReliableSales?num(kpi.sold_ads):'—'} description={hasShopeePartial?'SKU exclusivo · dados parciais':'No período'} selected={status==='SOLD'}
        onClick={()=>change(setStatus,status==='SOLD'?'ALL':'SOLD')}/>
      <Kpi tone="rose" label={hasShopeePartial?'Sem vendas identificadas':'Sem vendas'}
        value={hasShopeePartial&&data?num(emptyIdentifiedAds):hasReliableSales?num(kpi.zero_ads):'—'}
        description={hasShopeePartial?'Anúncios ou variações · indicativo':'Anúncios ou variações'}
        selected={status==='ZERO'} onClick={()=>change(setStatus,status==='ZERO'?'ALL':'ZERO')}/>
      <Kpi tone="sand" label={hasShopeePartial?(importedMonthTotal?'Unidades vendidas':'Unidades vinculadas'):'Unidades vendidas'} value={shopeeTotals?.units!=null?num(shopeeTotals.units):hasReliableSales?num(kpi.units):'—'} description={hasShopeePartial?linkedSalesDescription:salesCoverageLabel}/>
      <Kpi tone="green" label={hasShopeePartial?(importedMonthTotal?'Faturamento bruto importado':'Faturamento vinculado'):'Faturamento'} value={shopeeTotals?.revenue!=null?money(shopeeTotals.revenue):hasReliableSales?money(kpi.revenue):'—'} description={hasShopeePartial?linkedSalesDescription:salesCoverageLabel}/>
    </div>
    <section className="nim-filter-panel" aria-label="Filtros de plataforma, anúncio, período, situação de vendas e Curva ABC">
      <div className="nim-filter-top">
        <label className="nim-filter-field nim-filter-platform">Plataforma
          <select value={platform} onChange={e=>{
            if(e.target.value==='SHOPEE'){
              setCurve('ALL');
              // Na Shopee, preservar o filtro exploratório sem vendas identificadas.
            }
            if(['RISING','FALLING'].includes(status))setStatus('ALL');
            change(setPlatform,e.target.value);
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
                  // Na Shopee, preservar o filtro exploratório sem vendas identificadas.
                }
                if(choice==='MONTH'&&['RISING','FALLING'].includes(status))setStatus('ALL');
                change(setDays,choice==='MONTH'?0:Number(choice));
              }}>
              {PERIODS.map(n=><option key={n} value={n}>
                {platform==='SHOPEE'?<>{n} dias · dados importados</>:<>Últimos {n} dias</>}
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
              className={status===code?'active':''} aria-pressed={status===code}
              onClick={()=>change(setStatus,code)}
              title={hasShopeePartial&&code==='ZERO'?'Filtro exploratório: anúncios ou variações sem vendas vinculadas; não é zero comprovado':undefined}>
              {hasShopeePartial&&code==='ZERO'?'Sem vendas identificadas':label}{data&&code==='ALL'?' ('+num(kpi.active_ads)+')':''}
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
        {hasShopeePartial&&data?<>
          <span className="nim-filter-panel-identified">{num(classified.identified)} anúncios com vendas identificadas</span>
          <span className="nim-filter-panel-unclassified">{num(classified.unclassified)} anúncios sem vendas vinculadas; não significa zero</span>
        </>:Number(kpi.pending_ads)>0&&<span className="nim-filter-panel-warning">{num(kpi.pending_ads)} anúncio(s) com dados pendentes</span>}
        {status==='ZERO'&&<span className="nim-filter-panel-note">{hasShopeePartial
          ?num(emptyIdentifiedVars)+' variações sem vendas identificadas · ausência não comprovada'
          :'Inclui anúncios com variações sem vendas'}</span>}
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
          <table className="nim-ad-table"><thead><tr>
            <th>Plataforma</th><th>Nome e ID do anúncio</th><th>{hasShopeePartial?'Unid. vinculadas':'Unid.'} {periodLabel(days,month)}</th>
            <th>Variações</th><th>{hasShopeePartial?'Faturamento vinculado':'Faturamento'}</th><th>ABC</th><th>Vendas</th>
          </tr></thead><tbody>
            {!loading&&rows.map(item=><tr key={item.id} className={selectedId===item.id?'selected':''}
              onClick={()=>setSelectedId(item.id)} title="Ver anúncio e suas variações">
              <td><PlatformLabel item={item}/></td>
              <td><strong className="nim-ad-name">{item.title}</strong>
                <small className="nim-ad-id">{item.external_listing_id}</small></td>
              <td className="nim-units">{item.ready?num(item.units):hasShopeePartial&&Number(item.month_linked_units||item.identified_units)>0?num(item.month_linked_units||item.identified_units):'—'}</td>
              <td><span className="nim-variations-cell">{item.total_variations?num(item.total_variations)+' variações':'Sem variações'}
                <VariationSalesEvidence item={item} days={days} partial={hasShopeePartial}/>
              </span></td>
              <td className="nim-money">{item.ready?money(item.revenue):hasShopeePartial&&Number(item.month_linked_units||item.identified_units)>0?money(item.month_linked_revenue||item.identified_revenue):'—'}</td>
              <td>{item.curve?<span className={'nim-curve badge-'+item.curve.toLowerCase()}
                title={item.curve_partial?'ABC indicativa: calculada apenas com vendas identificadas':'Curva ABC por vendas consolidadas'}>{item.curve}{item.curve_partial?'*':''}</span>:'—'}</td>
              <td><Situation item={item}/></td>
            </tr>)}
            {loading&&<tr><td colSpan={7} className="nim-table-empty">Carregando anúncios…</td></tr>}
            {!loading&&!error&&rows.length===0&&<tr><td colSpan={7} className="nim-table-empty">Nenhum anúncio encontrado para o filtro. {hasShopeePartial&&'A ausência de vendas vinculadas não comprova venda zero.'}</td></tr>}
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
      {selected&&<ListingDetail key={[selected.id,days,month].join(':')} item={selected} days={days} month={month} zeroFilter={status==='ZERO'} onClose={()=>setSelectedId(null)}/>}
    </div>
    {platform==='SHOPEE'&&(days!==0||Boolean(month))&&
      ['ALL','SOLD'].includes(status)&&curve==='ALL'&&
      <ShopeeUnlinkedSales days={days} month={month}
        importedThrough={data?.imported_month?.period_end}
        search={search} revision={refresh} salesRevision={salesRevision}/>}
    <p className="nim-footnote">Na Shopee, o faturamento bruto mensal é o total conferido nas importações; os valores individuais são subtotais vinculados por SKU, não necessariamente o total do anúncio. Nos períodos de 7/30/60/90 dias, os KPIs mostram somente vendas vinculadas, sem presumir cobertura completa. “Sem vendas identificadas” não comprova zero real; ABC* é indicativa e considera somente vendas vinculadas ao anúncio. Tendência compara períodos equivalentes apenas com vendas identificadas, exige pelo menos 3 unidades anteriores e não presume vendas zero. Nenhum dado do Scanner é alterado.</p>
  </section>;
}
