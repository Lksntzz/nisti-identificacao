import React,{useEffect,useState} from 'react';
import CommercialIcon from './vendor/CommercialIcon.jsx';
import './commerce-variation-review.css';

const API='/api/admin/commerce/listings/manager/variation-review';
const PERIODS=[30,60,90], PAGE=15;
const num=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const day=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';
const source=s=>s==='SHOPEE'?'Shopee':s==='ML_NOVO'?'Mercado Livre Novo':'Mercado Livre Antigo';
const validCount=n=>n!=null&&Number.isFinite(Number(n));
const units=(v,n)=>v?.['units_'+n];
const covered=(v,n)=>v?.['coverage_'+n]===true;
const identified=(v,n)=>v?.['identified_'+n];
function statusOf(v,n){
  if(v?.match_verified!==true)return 'LINK';
  if(!validCount(units(v,n)))return 'UNKNOWN';
  if(Number(units(v,n))===0)return 'ZERO';
  return covered(v,n)?'SOLD':'PARTIAL_SOLD';
}
function Reason({variation,listing,days}){
  const st=statusOf(variation,days);
  const others=Number(listing.sold_variations||0);
  if(st==='LINK'){
    const reason=variation.match_issue==='MISSING_SKU'
      ?'A variação está sem SKU válido no catálogo.'
      :variation.match_issue==='DUPLICATE_SKU'
        ?'O mesmo SKU aparece em mais de uma variação deste anúncio.'
        :'O vínculo exclusivo do SKU da Shopee ainda não foi confirmado.';
    return <div className="nim-vr-reason"><b>Problema de identificação confirmado</b>
      <p>{reason} Revise o código e a associação antes de avaliar as vendas.</p></div>;
  }
  if(st==='UNKNOWN'){
    return <div className="nim-vr-reason"><b>Relatório incompleto</b>
      <p>Não foi possível comprovar vendas zero nos {days} dias.
        {validCount(identified(variation,days))&&Number(identified(variation,days))===0
          ?' Nenhuma venda foi identificada no intervalo disponível, mas faltam dias de cobertura.':''}
        {' '}Importe os dias ausentes para concluir a avaliação.</p></div>;
  }
  if(st==='SOLD'||st==='PARTIAL_SOLD'){
    return <div className="nim-vr-reason"><b>Venda identificada</b>
      <p>{st==='PARTIAL_SOLD'?'Quantidade mínima identificada; o período ainda não está completo.':
        'Há vendas vinculadas à variação no período selecionado.'} Nenhum motivo de ausência de vendas foi detectado.</p></div>;
  }
  const v30=units(variation,30),v60=units(variation,60),v90=units(variation,90);
  const history=days===30&&validCount(v60)&&Number(v60)>0
    ?'Ela vendeu entre 31 e 60 dias atrás, mas não nos últimos 30.'
    :days<=60&&validCount(v90)&&Number(v90)>0
      ?'Há histórico de vendas entre 61 e 90 dias atrás.'
      :days===90&&v90===0?'Não há vendas confirmadas nos 90 dias analisados.':'';
  return <div className="nim-vr-reason"><b>O que os dados comprovam</b>
    <p>Esta variação não teve unidades vendidas no período completo de {days} dias.
      {others>0?' Outras variações do mesmo anúncio venderam.':''} {history}</p>
    <b>Possíveis causas para conferir — não comprovadas</b>
    <p>Estoque da variação, preço frente às outras opções, imagem, título, demanda,
      disponibilidade no marketplace e tráfego. O NISTI ainda não possui visitas ou estoque por variação.</p></div>;
}
function Metric({n,variation}){
  const st=statusOf(variation,n),value=units(variation,n);
  return <span className={'nim-vr-cell '+st.toLowerCase()} title={
    st==='LINK'?'SKU sem vínculo validado':st==='UNKNOWN'?'Período incompleto':
      st==='PARTIAL_SOLD'?'Vendas mínimas identificadas; cobertura parcial':'Vendas confirmadas'}>
    {validCount(value)?(st==='PARTIAL_SOLD'?'≥ ':'')+num(value):'—'}
    <small>{st==='LINK'?'Vínculo pendente':st==='UNKNOWN'?'Incompleto':
      st==='PARTIAL_SOLD'?'Identificadas':st==='ZERO'?'Sem vendas':'Vendidas'}</small>
  </span>;
}
function Advertisement({item,days}){
  const [onlyIssues,setOnlyIssues]=useState(false);
  const vars=Array.isArray(item.variations)?item.variations:[];
  const shown=vars.filter(v=>!onlyIssues||['ZERO','UNKNOWN','LINK'].includes(statusOf(v,days)))
    .sort((a,b)=>{
      const order={ZERO:0,LINK:1,UNKNOWN:2,PARTIAL_SOLD:3,SOLD:4};
      return order[statusOf(a,days)]-order[statusOf(b,days)]
        ||String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
    });
  return <details className="nim-vr-ad" key={item.listing_id}>
    <summary className="nim-vr-ad-summary">
      <span className="nim-vr-disclose" aria-hidden="true"><CommercialIcon name="chevron-right" size={16}/></span>
      <span className="nim-vr-ad-name"><strong>{item.title}</strong>
        <small>{source(item.source)} · ID {item.external_listing_id}
          {' · '}até {day(item.period_end)}</small></span>
      <span className="nim-vr-ad-totals">
        <span>{num(item.variation_count)} variações</span>
        <b className={Number(item.zero_variations)>0?'has-zero':''}>
          {num(item.zero_variations)} sem vendas confirmadas</b>
        <small>{num(item.unknown_variations)} com dados pendentes</small>
      </span>
    </summary>
    <div className="nim-vr-ad-body">
      <div className="nim-vr-ad-actions">
        <p>Vendas de cada variação. Zero só aparece quando há cobertura e SKU verificados.</p>
        <label><input type="checkbox" checked={onlyIssues}
          onChange={e=>setOnlyIssues(e.target.checked)}/> Mostrar apenas sem vendas ou pendentes</label>
        {item.url&&<a href={item.url} target="_blank" rel="noopener noreferrer">Abrir anúncio ↗</a>}
      </div>
      <div className="nim-vr-table-scroll"><table className="nim-vr-table">
        <thead><tr><th>Variação / SKU</th><th>30 dias</th><th>60 dias</th><th>90 dias</th><th>Situação em {days} dias</th></tr></thead>
        <tbody>{shown.map(v=><React.Fragment key={v.id}>
          <tr><td><strong>{v.name}</strong><small>SKU: {v.sku||'Não informado'}</small></td>
            {PERIODS.map(n=><td key={n}><Metric n={n} variation={v}/></td>)}
            <td><span className={'nim-vr-tag '+statusOf(v,days).toLowerCase()}>
              {statusOf(v,days)==='ZERO'?'Sem vendas confirmadas':
                statusOf(v,days)==='SOLD'?'Com vendas':
                statusOf(v,days)==='PARTIAL_SOLD'?'Vendas identificadas':
                statusOf(v,days)==='LINK'?'SKU pendente':'Sem comprovação'}</span></td>
          </tr>
          {['ZERO','LINK','UNKNOWN'].includes(statusOf(v,days))&&<tr className="nim-vr-detail-row">
            <td colSpan={5}><Reason variation={v} listing={item} days={days}/></td>
          </tr>}
        </React.Fragment>)}</tbody></table></div>
      {shown.length===0&&<p className="nim-vr-empty">Todas as variações têm venda identificada neste período.</p>}
    </div>
  </details>;
}
export default function CommerceVariationReview({platform='TODAS',onPlatformChange=()=>{},revision=0,salesRevision=0}){
  const [days,setDays]=useState(30),[onlyZero,setOnlyZero]=useState(false);
  const [text,setText]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0);
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{const timer=setTimeout(()=>setSearch(text.trim()),300);return ()=>clearTimeout(timer);},[text]);
  useEffect(()=>setOffset(0),[platform,days,search,onlyZero]);
  useEffect(()=>{
    const ctrl=new AbortController();
    setLoading(true);setError('');setData(null);
    const qs=new URLSearchParams({platform,days:String(days),only_zero:onlyZero?'1':'0',
      limit:String(PAGE),offset:String(offset)});
    if(search)qs.set('search',search);
    fetch(API+'?'+qs,{credentials:'same-origin',cache:'no-store',signal:ctrl.signal})
      .then(async res=>{const x=await res.json().catch(()=>({}));
        if(!res.ok)throw Error(x.error||'Falha na análise de variações.');return x;})
      .then(x=>{if(!ctrl.signal.aborted)setData(x);})
      .catch(e=>{if(!ctrl.signal.aborted)setError(e.message);})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[platform,days,search,onlyZero,offset,revision,salesRevision]);
  const kpis=data?.kpis||{},rows=data?.items||[],total=Number(data?.total||0);
  const cover=Array.isArray(data?.coverage)?data.coverage:[];
  return <section className="nim-variation-review" aria-label="Análise de variações por anúncio">
    <div className="nim-vr-heading"><div><h3>Vendas por variação de anúncio</h3>
      <p>Identifique quais opções venderam em 30, 60 e 90 dias, com a situação do SKU e a qualidade dos dados.</p></div></div>
    <div className="nim-vr-filters">
      <label>Plataforma<select value={platform} onChange={e=>onPlatformChange(e.target.value)}>
        <option value="TODAS">Todas</option><option value="SHOPEE">Shopee</option>
        <option value="MERCADO_LIVRE">Mercado Livre</option>
        <option value="ML_ANTIGO">Mercado Livre Antigo</option>
        <option value="ML_NOVO">Mercado Livre Novo</option>
      </select></label>
      <label>Período principal<select value={days} onChange={e=>setDays(Number(e.target.value))}>
        {PERIODS.map(n=><option key={n} value={n}>{n} dias</option>)}
      </select></label>
      <label>Procurar anúncio ou SKU<input value={text} maxLength={120}
        onChange={e=>setText(e.target.value)} placeholder="Nome, ID ou SKU"/></label>
      <label className="nim-vr-filter-check"><input type="checkbox" checked={onlyZero}
        onChange={e=>setOnlyZero(e.target.checked)}/> Apenas anúncios com variação sem vendas confirmadas</label>
    </div>
    <div className="nim-vr-kpis">
      <div><small>Anúncios com múltiplas variações</small><strong>{data?num(kpis.listings):'—'}</strong></div>
      <div><small>Com variação sem venda confirmada</small><strong>{data?num(kpis.with_zero):'—'}</strong></div>
      <div><small>Com dados ou vínculos pendentes</small><strong>{data?num(kpis.without_proof):'—'}</strong></div>
    </div>
    {cover.length>0&&<p className="nim-vr-coverage">
      Cobertura das importações: {cover.map(c=>source(c.source)+' até '+day(c.end_date)+
        ' · '+(c['complete_'+days]?'janela confirmada':'janela incompleta')).join(' | ')}.
      Resultados de Shopee sem todos os dias importados não são apresentados como zero.
    </p>}
    {error&&<div className="nim-vr-error" role="alert">{error}</div>}
    {loading&&<p className="nim-vr-empty" role="status">Consultando relatórios e variações…</p>}
    {!loading&&!error&&<>
      <div className="nim-vr-results-title">
        <strong>{num(total)} anúncio(s) no filtro</strong>
        <small>{total>0?'Mostrando '+num(offset+1)+'–'+num(Math.min(total,offset+rows.length)):'Nenhum anúncio corresponde aos critérios'}</small>
      </div>
      {rows.length===0&&<p className="nim-vr-empty">Nenhum anúncio com variações foi encontrado. Uma variação sem venda identificada não é automaticamente classificada como zero.</p>}
      <div className="nim-vr-list">{rows.map(item=><Advertisement key={item.listing_id} item={item} days={days}/>)}</div>
      {total>PAGE&&<footer className="nim-list-footer">
        <span>Página {Math.floor(offset/PAGE)+1} de {Math.ceil(total/PAGE)}</span>
        <div><button type="button" disabled={offset===0} onClick={()=>setOffset(n=>Math.max(0,n-PAGE))}>Anterior</button>
          <button type="button" disabled={offset+PAGE>=total} onClick={()=>setOffset(n=>n+PAGE)}>Próxima</button></div>
      </footer>}
    </>}
    <p className="nim-vr-disclaimer">Diagnóstico baseado em vendas e vínculo de SKU nos relatórios existentes. Não inferimos causa comercial,
      estoque esgotado, preço inadequado ou falta de tráfego sem fontes que comprovem esses fatos.
      As janelas de 30, 60 e 90 dias terminam na última data importada em cada plataforma.</p>
  </section>;
}
