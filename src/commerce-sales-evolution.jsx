import React,{useEffect,useState} from 'react';
import CommercialIcon from './vendor/CommercialIcon.jsx';
import CommerceEvolutionProductThumbnail from './commerce-evolution-product-thumbnail.jsx';

const API='/api/admin/commerce/listings/manager/evolution';
const PAGE=25;
const platforms=[['TODAS','Todas as plataformas'],['SHOPEE','Shopee'],['MERCADO_LIVRE','Mercado Livre'],
  ['ML_ANTIGO','Mercado Livre Antigo'],['ML_NOVO','Mercado Livre Novo']];
const statuses=[['ALL','Todos'],['FALLING','Em queda'],['ZERO','SKU/modelo sem vendas'],['RISING','Em crescimento'],
  ['NEW','Novas vendas'],['STABLE','Estáveis'],['LOW_VOLUME','Baixo volume'],['INSUFFICIENT','Dados insuficientes']];
const labels=Object.fromEntries(statuses);
const num=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';
const platformName=s=>s==='SHOPEE'?'Shopee':s==='ML_NOVO'?'Mercado Livre Novo':'Mercado Livre Antigo';
const actions={
  RISING:'Conferir estoque e manter a divulgação. Um desconto pode não ser necessário.',
  FALLING:'Investigar preço, estoque e concorrência. Considerar promoção somente depois de conferir a margem.',
  STABLE:'Acompanhar e testar melhorias pontuais no anúncio.',
  NEW:'Começou a registrar vendas; acompanhar antes de concluir que há tendência consolidada.',
  LOW_VOLUME:'Pouco volume para concluir crescimento ou queda. Acompanhar mais dias.',
  INSUFFICIENT:'Os dois períodos não têm cobertura completa. Não interpretar ausência de dados como queda.'
};
function advice(item){
  if(item.trend!=='ZERO')return actions[item.trend]||actions.INSUFFICIENT;
  return Number(item.previous_units)>0
    ?'O SKU/modelo vendeu anteriormente e agora não teve vendas identificadas. Confira também as outras variações antes de avaliar o anúncio.'
    :'Não houve vendas identificadas neste SKU/modelo nos dois períodos. Confira outras variações e possíveis mudanças de código antes de concluir que o anúncio parou.';
}
function Bars({item}){
  const prev=Number(item.previous_units||0),cur=Number(item.current_units||0);
  const max=Math.max(1,prev,cur);
  return <div className="nim-evolution-bars" aria-label="Comparação de unidades">
    {[[prev,'Anterior','previous'],[cur,'Atual','current']].map(([n,label,type])=>
      <div key={type}><span>{label}</span><div className="nim-evolution-bar-track">
        <span className={type} style={{width:(n/max*100)+'%'}}/></div><strong>{num(n)}</strong></div>)}
  </div>;
}
export default function CommerceSalesEvolution({platform='TODAS',onPlatformChange=()=>{},initialDays=30,onPeriodChange=()=>{},trendRequest=null,revision=0,salesRevision=0}){
  const source=platforms.some(([id])=>id===platform)?platform:'TODAS';
  const [days,setDays]=useState([7,30,60,90].includes(initialDays)?initialDays:30),[status,setStatus]=useState('ALL'),[draft,setDraft]=useState('');
  const [search,setSearch]=useState(''),[offset,setOffset]=useState(0);
  const [data,setData]=useState(null),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const timer=setTimeout(()=>setSearch(draft.trim()),300);return ()=>clearTimeout(timer);},[draft]);
  useEffect(()=>setOffset(0),[source,days,status,search]);
  useEffect(()=>{if(trendRequest?.status)setStatus(trendRequest.status);},[trendRequest]);
  useEffect(()=>{
    const ctrl=new AbortController();
    const params=new URLSearchParams({platform:source,days:String(days),status,
      limit:String(PAGE),offset:String(offset)});
    if(search)params.set('search',search);
    setData(null);setLoading(true);setError('');
    fetch(API+'?'+params,{credentials:'same-origin',cache:'no-store',signal:ctrl.signal})
      .then(async res=>{
        const body=await res.json().catch(()=>({}));
        if(!res.ok)throw new Error(body.error||'Falha ao analisar a evolução.');
        return body;
      }).then(body=>{if(!ctrl.signal.aborted)setData(body);})
      .catch(err=>{if(!ctrl.signal.aborted)setError(err.message);})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[source,days,status,search,offset,revision,salesRevision,retry]);
  const counts=data?.kpis||{};
  const countFor=s=>counts[s==='NEW'?'new':s==='LOW_VOLUME'?'low_volume':
    s==='INSUFFICIENT'?'insufficient':s.toLowerCase()];
  const rows=Array.isArray(data?.items)?data.items:[];
  const total=Number(data?.total||0);
  const incomplete=(data?.coverage||[]).filter(v=>
    (!v.current_complete||!v.previous_complete)&&
    (v.current_days>0||v.previous_days>0||source===v.source));
  return <section className="nim-evolution" aria-label="Análise de evolução de vendas">
    <div className="nim-evolution-filter-panel">
    <header className="nim-evolution-heading"><div>
      <h3>Filtros e comparação</h3>
      <p>Compare produtos em períodos equivalentes e identifique oportunidades comerciais.</p>
    </div><div className="nim-evolution-interval">
      <strong><CommercialIcon name="calendar-days" size={16}/>
        {data?date(data.period_start)+' a '+date(data.period_end):'Período de '+days+' dias'}</strong>
      {data&&<small>Anterior: {date(data.previous_start)} a {date(data.previous_end)}</small>}
    </div></header>
    <div className="nim-evolution-controls">
      <label><CommercialIcon name="package" size={17}/>Plataforma<select value={source} onChange={e=>onPlatformChange(e.target.value)}>
        {platforms.map(([code,label])=><option value={code} key={code}>{label}</option>)}
      </select></label>
      <label><CommercialIcon name="calendar-days" size={17}/>Comparar períodos<select value={days} onChange={e=>{const selected=Number(e.target.value);setDays(selected);onPeriodChange(selected);}}>
        {[7,30,60,90].map(n=><option value={n} key={n}>{n} dias × {n} anteriores</option>)}
      </select></label>
      <label><CommercialIcon name="circle-alert" size={17}/>Situação das vendas<select value={status} onChange={e=>setStatus(e.target.value)}
        aria-label="Filtrar evolução pela situação das vendas">
        {statuses.map(([code,label])=><option value={code} key={code}>
          {label}{data&&code!=='ALL'?' ('+num(countFor(code))+')':''}
        </option>)}
      </select></label>
      <label><CommercialIcon name="search" size={17}/>Pesquisar produto ou SKU<input type="search" value={draft} maxLength={120}
        onChange={e=>setDraft(e.target.value)} placeholder="Nome, SKU ou anúncio"/></label>
    </div>
    </div>
    <p className="nim-evolution-method">Crescimento e queda exigem variação de pelo menos 20%,
      mínimo de 3 unidades no período anterior e diferença de 2 unidades.
      Pouco volume e cobertura incompleta são tratados separadamente. Não criamos promoções automaticamente.</p>
    {incomplete.length>0&&<p className="nim-evolution-notice">
      Cobertura incompleta: {incomplete.map(c=>platformName(c.source)).join(', ')}.
      Sem presumir vendas zero ou tendências nessa origem.</p>}
    {error&&<p className="nim-evolution-error" role="alert">{error}
      <button type="button" onClick={()=>setRetry(n=>n+1)}>Tentar novamente</button></p>}
    {loading&&<p className="nim-evolution-state">Consultando vendas importadas…</p>}
    {!loading&&!error&&<>
      <div className="nim-evolution-results-head">
        <strong>{num(total)} SKU(s)/modelo(s) no filtro</strong>
        <span>Unidades e faturamento bruto dos produtos, não lucro</span>
      </div>
      {rows.length===0&&<p className="nim-evolution-state">Nenhum produto encontrado no filtro.</p>}
      <div className="nim-evolution-table-head" aria-hidden="true">
        <span>Produto</span><span>Plataforma</span><span>SKU / Anúncio</span>
        <span>Situação</span><span>Vendas no período</span><span>Variação</span>
      </div>
      <div className="nim-evolution-grid">{rows.map(item=>{
        const growth=item.growth_pct==null?'—':
          (Number(item.growth_pct)>0?'+':'')+
          new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(item.growth_pct))+'%';
        const modelHistory=Number(item.distinct_skus||0)>1;
        const listingIds=Array.isArray(item.listing_ids)?item.listing_ids.filter(Boolean):[];
        const sharedSku=item.source==='SHOPEE'&&listingIds.length>1;
        return <details className="nim-evolution-product" key={item.source+':'+item.model_key}>
          <summary className="nim-evolution-product-head" title="Abrir análise completa do produto">
            <div className="nim-evolution-primary">
              <CommercialIcon name="chevron-right" size={16} className="nim-evolution-disclosure-arrow"/>
              <CommerceEvolutionProductThumbnail url={item.image_url}
                source={item.image_source}/>
              <div className="nim-evolution-name">
                <strong title={item.title||'Produto vendido na plataforma'}>{item.title||'Produto vendido na plataforma'}</strong>
                <small>{modelHistory?'Histórico de versões de SKU':'Análise por SKU/modelo'}</small>
              </div>
            </div>
            <span className="nim-evolution-platform">{platformName(item.source)}</span>
            <span className="nim-evolution-identification">
              <strong>SKU {item.sku||item.sample_sku||item.model_key}</strong>
              <small>{sharedSku?'Vinculado a '+num(listingIds.length)+' anúncios':
                item.listing_id?'Anúncio '+item.listing_id:'Sem ID exclusivo de anúncio identificado'}</small>
            </span>
            <span className={'nim-evolution-tag '+String(item.trend||'').toLowerCase()}>
              {item.trend==='RISING'&&<CommercialIcon name="trending-up" size={14}/>}
              {item.trend==='FALLING'&&<CommercialIcon name="trending-down" size={14}/>}
              {labels[item.trend]||'Dados insuficientes'}</span>
            <span className="nim-evolution-quick-stats"><b>{num(item.current_units)} un.</b></span>
            <span className={'nim-evolution-growth '+(item.trend==='RISING'?'positive':
              item.trend==='FALLING'?'negative':'neutral')}>
              {item.trend==='RISING'&&<CommercialIcon name="trending-up" size={15}/>}
              {item.trend==='FALLING'&&<CommercialIcon name="trending-down" size={15}/>}
              {growth}</span>
          </summary>
          <div className="nim-evolution-detail">
            <header className="nim-evolution-detail-heading">
              <div>
                <span className="nim-evolution-detail-eyebrow">DETALHAMENTO DO PRODUTO</span>
                <h4>{item.title||'Produto vendido na plataforma'}</h4>
                <p>Comparação de {days} dias por SKU/modelo · {platformName(item.source)}</p>
              </div>
              <span className="nim-evolution-detail-period">Janela de {days} dias</span>
            </header>
            <div className="nim-evolution-detail-section-title">Indicadores de vendas</div>
          <div className="nim-evolution-product-stats">
            <div><small>Unidades atuais</small><strong>{num(item.current_units)}</strong>
              <span>{money(item.current_revenue)}</span></div>
            <div><small>Unidades anteriores</small><strong>{num(item.previous_units)}</strong>
              <span>{money(item.previous_revenue)}</span></div>
            <div><small>Evolução</small>
              <strong className={item.trend==='RISING'?'positive':
                ['FALLING','ZERO'].includes(item.trend)?'negative':''}>{growth}</strong>
              <span>{Number(item.delta_units)>0?'+':''}{num(item.delta_units)} un.</span>
            </div>
          </div>
          <Bars item={item}/>
          {sharedSku&&<div className="nim-evolution-shared-sku" role="note">
            <strong>{item.shared_product?'Mesmo produto em '+num(listingIds.length)+' anúncios':
              'SKU compartilhado por '+num(listingIds.length)+' anúncios'}</strong>
            <span>IDs dos anúncios: {listingIds.join(' · ')}</span>
            <span>Quantidade de vendas do SKU: <b>{num(item.current_units)} unidade(s) identificada(s)</b> neste período.</span>
            <small>Os IDs estão agrupados, e cada unidade vendida é contada uma única vez.
              O relatório de pedidos não permite dividir essas vendas por anúncio.
              {Number(item.current_units)===0&&
                ' Nenhuma venda deste SKU foi identificada no período; isso não comprova vendas zero em cada anúncio.'}</small>
          </div>}
          <div className="nim-evolution-advice"><strong>Ação comercial sugerida</strong>
            <p>{advice(item)}</p></div>
          {modelHistory&&<p className="nim-evolution-info">
            Histórico agrupado pelo modelo, incluindo versões antigas de SKU;
            não comprova que todas as vendas vieram do anúncio atual.</p>}
          {item.source==='SHOPEE'&&item.trend==='ZERO'&&<p className="nim-evolution-info">
            Sem vendas registradas no SKU/modelo conhecido; uma mudança de código
            não identificada pode ocultar vendas do anúncio.</p>}

          </div>
        </details>;
      })}</div>
      {total>PAGE&&<footer className="nim-list-footer nim-evolution-footer">
        <span>Página {Math.floor(offset/PAGE)+1} de {Math.ceil(total/PAGE)}</span>
        <div><button type="button" disabled={offset===0}
          onClick={()=>setOffset(o=>Math.max(0,o-PAGE))}>Anterior</button>
          <button type="button" disabled={offset+PAGE>=total}
            onClick={()=>setOffset(o=>o+PAGE)}>Próxima</button></div></footer>}
    </>}
    <p className="nim-evolution-legal">Base: todas as vendas diárias importadas da
      Shopee e do Mercado Livre, inclusive SKUs sem vínculo com anúncios ativos.
      Um SKU sem venda não comprova ausência de pedidos no anúncio quando houve mudança
      de código. SKUs compartilhados por vários IDs têm vendas exibidas uma única vez,
      sem rateio por anúncio. O histórico de modelos AGMT reúne versões sem inventar vendas.</p>
  </section>;
}
