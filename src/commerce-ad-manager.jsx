import React,{useEffect,useMemo,useState} from 'react';
import CommerceImportCenter from './commerce-import-center.jsx';
import './commerce-ad-manager.css';
import { listingSalesSituation } from './commerce-listing-classification.js';

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
  const situation=listingSalesSituation(item);
  if(situation==='PENDING')return <span className="nim-status pending">Dados pendentes</span>;
  if(situation==='ZERO')return <span className="nim-status zero">Sem vendas</span>;
  return <span className="nim-status sold">Com vendas</span>;
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
  const [error,setError]=useState('');
  const [showAll,setShowAll]=useState(false);
  const [activeTab,setActiveTab]=useState('summary');
  const [detailDays,setDetailDays]=useState(days);
  const [periodResult,setPeriodResult]=useState(null);
  const [periodLoading,setPeriodLoading]=useState(false);
  const [periodError,setPeriodError]=useState('');
  useEffect(()=>{
    let cancelled=false;setMonths(null);setError('');setShowAll(false);
    readJson(API+'/'+encodeURIComponent(item.id)+'/months')
      .then(x=>{if(!cancelled)setMonths(x.months||[]);})
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
  const detail=detailDays===days?item:
    periodResult?.days===detailDays?periodResult.item:null;
  const variations=Array.isArray(detail?.variations)?detail.variations:[];
  const relevant=zeroFilter&&!showAll?variations.filter(v=>v.units===0):variations;
  const complete=Boolean(detail?.ready&&detail?.variation_data_complete);
  const pending=!detail?.ready;
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
      <div><small>Curva ABC</small><strong>{item.curve||'—'}</strong></div>
    </div>
    <section className="nim-detail-performance" aria-label="Desempenho do anúncio">
      <div className="nim-detail-section-title nim-detail-performance-title">
        <h4>Desempenho</h4>
        <div className="nim-detail-periods" role="group" aria-label="Período de análise do anúncio">
          {days===0&&<button type="button" aria-pressed={detailDays===0}
            className={detailDays===0?'active':''} onClick={()=>setDetailDays(0)}>Mês</button>}
          {PERIODS.map(p=><button type="button" key={p} aria-pressed={detailDays===p}
            className={detailDays===p?'active':''} onClick={()=>setDetailDays(p)}>{p}d</button>)}
        </div>
      </div>
      <div className="nim-detail-metrics">
        <DetailMetric label="Unidades vendidas" value={pending?'—':num(detail.units)} description={periodLabel(detailDays,month)}/>
        <DetailMetric label="Faturamento" value={pending?'—':money(detail.revenue)} description={periodLabel(detailDays,month)+' · produtos'}/>
        <DetailMetric label="Pedidos" value="—" description="Aguardando vínculo por anúncio"/>
        <DetailMetric label="Ticket médio" value="—" description="Aguardando pedidos identificados"/>
      </div>
      {periodLoading&&<p className="nim-detail-pending" role="status">Consultando dados: {periodLabel(detailDays,month)}…</p>}
      {periodError&&<p className="nim-detail-pending nim-detail-period-error" role="alert">{periodError}</p>}
      {pending&&!periodLoading&&!periodError&&<p className="nim-detail-pending">Dados de vendas ainda não consolidados para {periodLabel(detailDays,month)}. Valores desconhecidos não são zero.</p>}
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
        <div className="nim-detail-section-title"><h4>Evolução de vendas</h4><small>Histórico mensal do anúncio</small></div>
        {error?<p className="nim-error" role="alert">{error}</p>:months===null?
          <p className="nim-subtle">Consultando histórico…</p>:<MonthBars months={months} basis="REVENUE"/>}
        {months?.length>0&&<div className="nim-month-values">
          {months.slice(-4).reverse().map(m=><div key={m.period}>
            <span>{labelMonth(m.period)}</span><strong>{num(m.units)} un. · {money(m.revenue)}</strong>
          </div>)}
        </div>}
        <div className="nim-detail-summary-footer">
          <div><strong>Variações cadastradas</strong>
            <span>{num(item.total_variations)} variações</span></div>
          <button type="button" onClick={()=>setActiveTab('variations')}>Ver variações →</button>
        </div>
        {!complete&&item.total_variations>0&&
          <p className="nim-subtle">As vendas individuais das variações só serão exibidas após vinculação confiável dos SKUs.</p>}
      </>}
      {activeTab==='finance'&&<>
        <div className="nim-detail-section-title"><h4>Resultado financeiro</h4><small>{periodLabel(detailDays,month)}</small></div>
        <div className="nim-detail-data-list">
          <DetailRow label="Subtotal dos produtos" value={pending?'—':money(detail.revenue)}
            description="Receita dos produtos no período selecionado"/>
          <DetailRow label="Descontos do vendedor" value="—"/>
          <DetailRow label={item.source==='SHOPEE'?"Comissões Shopee":"Comissões da plataforma"} value="—"/>
          <DetailRow label="Taxas de serviço" value="—"/>
          <DetailRow label="Receita após taxas identificadas" value="—"/>
        </div>
        <p className="nim-detail-hint">Os descontos e as taxas ainda não foram conciliados por anúncio. O subtotal não representa repasse ou lucro líquido.</p>
      </>}
      {activeTab==='variations'&&<>
        <div className="nim-detail-section-title">
          <h4>Desempenho por variação</h4><small>{num(item.total_variations)} variações</small>
        </div>
        {item.total_variations===0&&<p className="nim-subtle">Anúncio sem variações cadastradas.</p>}
        {item.total_variations>0&&!complete&&
          <p className="nim-advice">Ainda não é possível atribuir quantidades e receitas a todas as variações com segurança; não mostramos zeros presumidos.</p>}
        {item.total_variations>0&&complete&&
          <p className="nim-var-totals">{num(detail.sold_variations)} com vendas · {num(detail.zero_variations)} sem vendas</p>}
        {zeroFilter&&complete&&item.total_variations>0&&
          <label className="nim-var-toggle"><input type="checkbox" checked={showAll}
            onChange={e=>setShowAll(e.target.checked)}/> Mostrar todas as variações</label>}
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
        {item.total_variations>0&&!relevant.length&&
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
  const [monthly,setMonthly]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [importOpen,setImportOpen]=useState(false);
  const [monthlyOpen,setMonthlyOpen]=useState(false);
  useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),320);return ()=>clearTimeout(timer);},[query]);
  useEffect(()=>{setOffset(0);setSelectedId(null);},[platform,days,month,search,status,curve,basis,size]);
  useEffect(()=>{
    let cancelled=false;setLoading(true);setError('');
    const params=new URLSearchParams({platform,days:String(days),status,curve,basis,
      limit:String(size),offset:String(offset)});
    if(days===0 && month)params.set('month',month);
    if(search)params.set('search',search);
    if(days===0&&!month){setData(null);setLoading(false);return ()=>{cancelled=true;};}
    readJson(API+'?'+params).then(x=>{if(!cancelled)setData(x);})
      .catch(e=>{if(!cancelled){setData(null);setError(e.message);}})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[platform,days,month,search,status,curve,basis,size,offset,refresh,salesRevision]);
  useEffect(()=>{
    let cancelled=false;setMonthly(null);
    readJson(API+'/monthly?platform='+encodeURIComponent(platform))
      .then(x=>{if(!cancelled)setMonthly(x);})
      .catch(()=>{if(!cancelled)setMonthly({months:[]});});
    return ()=>{cancelled=true;};
  },[platform,refresh,salesRevision]);
  const kpi=data?.kpis||{};
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
      <Kpi tone="mint" label="Com vendas" value={data?num(kpi.sold_ads):'—'} description="No período" selected={status==='SOLD'}
        onClick={()=>change(setStatus,status==='SOLD'?'ALL':'SOLD')}/>
      <Kpi tone="rose" label="Sem vendas" value={data?num(kpi.zero_ads):'—'} description="Anúncios ou variações" selected={status==='ZERO'}
        onClick={()=>change(setStatus,status==='ZERO'?'ALL':'ZERO')}/>
      <Kpi tone="sand" label="Unidades vendidas" value={data?num(kpi.units):'—'} description={periodLabel(days,month)+' · anúncios ativos'}/>
      <Kpi tone="green" label="Faturamento" value={data?money(kpi.revenue):'—'} description={periodLabel(days,month)+' · anúncios ativos'}/>
    </div>
    <section className="nim-filter-panel" aria-label="Filtros de plataforma, anúncio, período, situação de vendas e Curva ABC">
      <div className="nim-filter-top">
        <label className="nim-filter-field nim-filter-platform">Plataforma
          <select value={platform} onChange={e=>change(setPlatform,e.target.value)}>
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
                change(setDays,choice==='MONTH'?0:Number(choice));
              }}>
              {PERIODS.map(n=><option key={n} value={n}>Últimos {n} dias</option>)}
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
      <div className="nim-filter-panel-body">
        <div className="nim-filter-group nim-performance-group">
          <span className="nim-filter-group-label">Situação de vendas</span>
          <div className="nim-status-tabs" role="group" aria-label="Filtrar anúncios por situação de vendas">
            {SALES_FILTERS.map(([code,label])=><button type="button" key={code}
              className={status===code?'active':''} aria-pressed={status===code}
              onClick={()=>change(setStatus,code)}>
              {label}{data&&code==='ALL'?' ('+num(kpi.active_ads)+')':''}
            </button>)}
          </div>
        </div>
        <div className="nim-filter-group nim-abc-group">
          <span className="nim-filter-group-label">Curva ABC</span>
          <div className="nim-abc-controls">
            <div className="nim-curve-tabs" role="group" aria-label="Filtrar anúncios por Curva ABC">
              {['ALL','A','B','C'].map(code=><button type="button" key={code}
                className={curve===code?'active':''} aria-pressed={curve===code}
                onClick={()=>change(setCurve,code)}>{code==='ALL'?'Todas':code}</button>)}
            </div>
            <label className="nim-abc-basis-label">
              <span>Classificar por</span>
              <select aria-label="Critério ABC" value={basis} onChange={e=>change(setBasis,e.target.value)}>
                <option value="REVENUE">Faturamento</option><option value="UNITS">Unidades vendidas</option>
              </select>
            </label>
          </div>
        </div>
      </div>
      <div className="nim-filter-panel-footer">
        <span className="nim-coverage">
          {days===0&&!month?'Selecione o mês no período personalizado.':data?.period_start
            ? 'Período analisado: '+periodDate(data.period_start)+' a '+periodDate(data.period_end)
            : 'Período de vendas conforme os filtros selecionados'}
        </span>
        {Number(kpi.pending_ads)>0&&<span className="nim-filter-panel-warning">{num(kpi.pending_ads)} anúncio(s) com dados pendentes</span>}
        {status==='ZERO'&&<span className="nim-filter-panel-note">Inclui anúncios com variações sem vendas</span>}
      </div>
    </section>
    {error&&<div className="nim-error" role="alert">{error}
      <button type="button" onClick={()=>setRefresh(v=>v+1)}>Tentar novamente</button></div>}
    <div className={'nim-content '+(selected?'has-detail':'')}>
      <section className="nim-list-panel">
        <div className="nim-list-header">
          <div><h3>Lista de anúncios</h3><small>{loading?'Consultando anúncios…':num(total)+' anúncios encontrados'}</small></div>
          <button type="button" className="nim-soft-button" onClick={()=>setMonthlyOpen(v=>!v)}
            aria-expanded={monthlyOpen}>{monthlyOpen?'Ocultar evolução mensal':'Analisar vendas mensais'} <span aria-hidden="true">{monthlyOpen?'−':'↗'}</span></button>
        </div>
        {monthlyOpen&&<div className="nim-month-summary">
          <h4>Evolução mensal · anúncios atualmente ativos</h4>
          <MonthBars months={monthly?.months} basis={basis}/>
        </div>}
        <div className="nim-table-scroll">
          <table className="nim-ad-table"><thead><tr>
            <th>Plataforma</th><th>Nome e ID do anúncio</th><th>Unid. {periodLabel(days,month)}</th>
            <th>Variações</th><th>Faturamento</th><th>ABC</th><th>Vendas</th>
          </tr></thead><tbody>
            {!loading&&rows.map(item=><tr key={item.id} className={selectedId===item.id?'selected':''}
              onClick={()=>setSelectedId(item.id)} title="Ver anúncio e suas variações">
              <td><PlatformLabel item={item}/></td>
              <td><strong className="nim-ad-name">{item.title}</strong>
                <small className="nim-ad-id">{item.external_listing_id}</small></td>
              <td className="nim-units">{item.ready?num(item.units):'—'}</td>
              <td><span className="nim-variations-cell">{item.total_variations?num(item.total_variations)+' variações':'Sem variações'}
                {item.ready&&item.zero_variations>0&&<small>{num(item.zero_variations)} sem vendas</small>}
                {item.total_variations>0&&(!item.ready||!item.variation_data_complete)&&<small>Quantidade não identificada</small>}
              </span></td>
              <td className="nim-money">{item.ready?money(item.revenue):'—'}</td>
              <td>{item.curve?<span className={'nim-curve badge-'+item.curve.toLowerCase()}>{item.curve}</span>:'—'}</td>
              <td><Situation item={item}/></td>
            </tr>)}
            {loading&&<tr><td colSpan={7} className="nim-table-empty">Carregando anúncios…</td></tr>}
            {!loading&&!error&&rows.length===0&&<tr><td colSpan={7} className="nim-table-empty">Nenhum anúncio encontrado para o filtro.</td></tr>}
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
      {selected&&<ListingDetail key={selected.id} item={selected} days={days} month={month} zeroFilter={status==='ZERO'} onClose={()=>setSelectedId(null)}/>}
    </div>
    <p className="nim-footnote">Valores por ID real do anúncio e conta da plataforma. O filtro Sem vendas inclui variações sem vendas quando há dados confiáveis. Variações não identificadas não são classificadas como sem vendas. Nenhum dado do Scanner é alterado.</p>
  </section>;
}
