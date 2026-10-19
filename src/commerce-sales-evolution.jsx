import React,{useEffect,useState} from 'react';

const API='/api/admin/commerce/listings/manager/evolution';
const PAGE=25;
const platforms=[['TODAS','Todas as plataformas'],['SHOPEE','Shopee'],['MERCADO_LIVRE','Mercado Livre'],
  ['ML_ANTIGO','Mercado Livre Antigo'],['ML_NOVO','Mercado Livre Novo']];
const statuses=[['ALL','Todos'],['FALLING','Em queda'],['ZERO','Sem vendas'],['RISING','Em crescimento'],
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
    ?'As vendas cessaram após um período com pedidos. Verificar disponibilidade, anúncio, preço e oferta.'
    :'Nenhuma venda registrada nos dois períodos. Revisar título, fotos, preço e distribuição antes de investir em divulgação.';
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
export default function CommerceSalesEvolution({platform='TODAS',onPlatformChange=()=>{},revision=0,salesRevision=0}){
  const source=platforms.some(([id])=>id===platform)?platform:'TODAS';
  const [days,setDays]=useState(30),[status,setStatus]=useState('ALL'),[draft,setDraft]=useState('');
  const [search,setSearch]=useState(''),[offset,setOffset]=useState(0);
  const [data,setData]=useState(null),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const timer=setTimeout(()=>setSearch(draft.trim()),300);return ()=>clearTimeout(timer);},[draft]);
  useEffect(()=>setOffset(0),[source,days,status,search]);
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
  const cards=[['RISING','Em crescimento','up'],['FALLING','Em queda','down'],
    ['STABLE','Estáveis','steady'],['ZERO','Sem vendas registradas','zero']];
  const rows=Array.isArray(data?.items)?data.items:[];
  const total=Number(data?.total||0);
  const incomplete=(data?.coverage||[]).filter(v=>!v.current_complete||!v.previous_complete);
  return <section className="nim-evolution" aria-label="Análise de evolução de vendas">
    <header className="nim-evolution-heading"><div>
      <h3>Evolução de Vendas</h3>
      <p>Compare produtos em períodos equivalentes e identifique oportunidades comerciais.</p>
    </div><div className="nim-evolution-interval">
      <strong>{data?date(data.period_start)+' a '+date(data.period_end):'Período de '+days+' dias'}</strong>
      {data&&<small>Anterior: {date(data.previous_start)} a {date(data.previous_end)}</small>}
    </div></header>
    <div className="nim-evolution-summary">{cards.map(([code,label,tone])=>
      <button key={code} type="button" aria-pressed={status===code}
        className={'nim-evolution-kpi '+tone+(status===code?' selected':'')}
        onClick={()=>setStatus(v=>v===code?'ALL':code)}>
        <small>{label}</small><strong>{data?num(countFor(code)):'—'}</strong>
      </button>)}</div>
    <div className="nim-evolution-controls">
      <label>Plataforma<select value={source} onChange={e=>onPlatformChange(e.target.value)}>
        {platforms.map(([code,label])=><option value={code} key={code}>{label}</option>)}
      </select></label>
      <label>Comparar períodos<select value={days} onChange={e=>setDays(Number(e.target.value))}>
        {[7,30,60,90].map(n=><option value={n} key={n}>{n} dias × {n} anteriores</option>)}
      </select></label>
      <label>Pesquisar produto ou SKU<input type="search" value={draft} maxLength={120}
        onChange={e=>setDraft(e.target.value)} placeholder="Nome, SKU ou anúncio"/></label>
    </div>
    <div className="nim-evolution-statuses" aria-label="Filtro de tendências">
      {statuses.map(([code,label])=><button type="button" key={code}
        className={status===code?'active':''} aria-pressed={status===code}
        onClick={()=>setStatus(code)}>
        {label}{data&&code!=='ALL'?' ('+num(countFor(code))+')':''}</button>)}
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
        <strong>{num(total)} produto(s) no filtro</strong>
        <span>Unidades e faturamento bruto dos produtos, não lucro</span>
      </div>
      {rows.length===0&&<p className="nim-evolution-state">Nenhum produto encontrado no filtro.</p>}
      <div className="nim-evolution-grid">{rows.map(item=>{
        const growth=item.growth_pct==null?'—':
          (Number(item.growth_pct)>0?'+':'')+
          new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(item.growth_pct))+'%';
        const modelHistory=String(item.model_key||'').startsWith('AGMT')
          &&Number(item.distinct_skus||0)>1;
        return <article className="nim-evolution-product" key={item.source+':'+item.model_key}>
          <header className="nim-evolution-product-head">
            <div className="nim-evolution-name">
              <strong>{item.title||'Produto vendido na plataforma'}</strong>
              <small>{platformName(item.source)} · SKU {item.sku||item.sample_sku||item.model_key}</small>
              {item.listing_id?<small>Anúncio {item.listing_id}</small>:
                <small>Sem ID exclusivo de anúncio identificado</small>}
            </div>
            <span className={'nim-evolution-tag '+String(item.trend||'').toLowerCase()}>
              {labels[item.trend]||'Dados insuficientes'}</span>
          </header>
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
          <div className="nim-evolution-advice"><strong>Ação comercial sugerida</strong>
            <p>{advice(item)}</p></div>
          {modelHistory&&<p className="nim-evolution-info">
            Histórico agrupado pelo modelo, incluindo versões antigas de SKU;
            não comprova que todas as vendas vieram do anúncio atual.</p>}
          {item.source==='SHOPEE'&&item.trend==='ZERO'&&<p className="nim-evolution-info">
            Sem vendas registradas no SKU/modelo conhecido; uma mudança de código
            não identificada pode ocultar vendas do anúncio.</p>}
        </article>;
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
      de código. O histórico de modelos AGMT reúne versões de SKU sem atribuir pedidos a outro ID.</p>
  </section>;
}
