import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {STRATEGIC_PLATFORMS,STRATEGIC_DAYS} from './commerce-strategic-logic.js';
import {scopeKey,isCurrentScope,matchesPlatform} from './commerce-platform-scope-logic.js';
import './commerce-strategic-view.css';

// GA-013 — Visão estratégica por conta (somente leitura). Só unidades: nada de valores financeiros nem ticket.
// GA-012: a resposta fica guardada com a chave conta|período e é descartada se conta OU dias não forem os escolhidos agora.
const nf=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const LABEL={CRESCIMENTO:'Crescimento',QUEDA:'Queda',ESTAVEL:'Estável',POUCO_VOLUME:'Pouco volume',PAROU:'Parou',
  SEM_VENDA_HISTORICO_IMPORTADO:'Sem venda no histórico importado',
  SEM_VENDAS_HISTORICO_NAO_VERIFICADO:'Sem venda nos dados importados (histórico não verificado)',
  SEM_VENDA_NO_PERIODO:'Sem venda no período',SEM_CLASSIFICACAO:'Não classificado'};
const REASON={PERIODO_ATUAL_NAO_COMPROVADO:'cobertura do período atual não comprovada',PERIODO_ANTERIOR_NAO_COMPROVADO:'cobertura do período anterior não comprovada',
  HISTORICO_NAO_COMPROVADO:'histórico não verificado'};
const BASIS={ANUNCIOS_VINCULADOS:'vendas dos anúncios vinculados',POR_ANUNCIO:'vendas por anúncio',TOTAL_POR_SKU:'total por SKU (inclui SKU sem vínculo)'};
const PART_PT={dashboard:'Dashboard',overview:'resumo de anúncios',monthly:'evolução mensal',series:'evolução diária',categories:'categorias',split:'divisão por SKU',quality:'cobertura',performance:'visitas e impressões'};

function Traffic({t}){
  if(!t||(t.visits==null&&t.impressions==null&&t.conversion_pct==null))return null;
  return <small className="nsv-traffic">{t.visits!=null&&<>Visitas {nf(t.visits)}</>}{t.impressions!=null&&<> · Impressões {nf(t.impressions)}</>}
    {t.conversion_pct!=null&&<> · Conversão {String(t.conversion_pct).replace('.',',')}%</>}{t.period&&<> ({t.period.start} a {t.period.end})</>}</small>;
}
function Row({r,showPrev}){
  return <li className="nsv-row"><div><b>{r.title||r.external_id||'Anúncio'}</b>{r.external_id&&<small> {r.external_id}</small>}<Traffic t={r.traffic}/>
    {r.last_sale&&<small>Última venda importada: {r.last_sale}{r.last_sale_verified===false?' (data não verificada)':''}</small>}</div>
    <div className="nsv-nums">{r.units!=null&&<span>{nf(r.units)} un.</span>}{showPrev&&r.units_previous!=null&&<small>antes {nf(r.units_previous)}</small>}
      {r.label&&<em className={'nsv-tag is-'+r.label.toLowerCase()} title={REASON[r.reason]||''}>{LABEL[r.label]||r.label}</em>}</div></li>;
}
function Block({title,children,notes=[],tone}){
  return <section className={'nsv-block'+(tone?' is-'+tone:'')}><h3>{title}</h3>{notes.filter(Boolean).map((n,i)=><p key={i} className="nsv-note">{n}</p>)}{children}</section>;
}
// Grupo de movimentos: título/contagem vêm do servidor e já distinguem "confirmado" de "possível".
const PREVIEW=10;
function Group({g,showPrev,partName}){
  const [all,setAll]=useState(false);
  if(!g)return null;
  const cand=g.kind==='CANDIDATO';
  return <Block title={g.title} tone={cand?'candidate':null}
    notes={[g.count_label,cand?'Candidatos pelos dados importados: a cobertura de vendas não comprova o período, então ainda não é uma classificação confirmada.':null,g.ordering_note,g.note,g.limit_note]}>
    {!g.available?<p className="nsv-error" role="status">Consulta indisponível no momento ({PART_PT[partName]||partName}): isto não significa que não existam anúncios.</p>
      :g.items.length===0?<p className="nsv-empty">Nenhum anúncio nesta lista.</p>
      :<><ul className="nsv-list">{(all?g.items:g.items.slice(0,PREVIEW)).map(r=><Row key={r.listing_id||r.external_id} r={r} showPrev={showPrev}/>)}</ul>
        {g.items.length>PREVIEW&&<button type="button" className="nsv-link" onClick={()=>setAll(x=>!x)}>{all?'Mostrar menos':'Mostrar todos os '+g.items.length+' carregados'}</button>}</>}
  </Block>;
}
const COV_TAG={COM_LACUNA:'com dias sem informação',NAO_VERIFICADA:'não verificado',SEM_INFORMACAO:'sem informação',NAO_VERIFICADO:'não verificado'};
function Bars({items}){
  const max=Math.max(1,...items.map(i=>i.units||0));
  return <ul className="nsv-bars">{items.map(i=>{const st=i.coverage||i.state;const flag=st&&st!=='OK'&&st!=='COMPROVADA'?COV_TAG[st]:null;
    return <li key={i.month||i.day} className={flag?'is-unverified':''} data-state={st||''}><span>{i.month||i.day}</span><i style={{width:Math.round((i.units||0)/max*100)+'%'}}/>
      <b>{st==='SEM_INFORMACAO'?'sem info':nf(i.units)}{flag&&st!=='SEM_INFORMACAO'&&<small> {flag}</small>}</b></li>;})}</ul>;
}

export default function CommerceStrategicView(){
  const [platform,setPlatform]=useState('SHOPEE');
  const [days,setDays]=useState(7);
  const [entry,setEntry]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [tick,setTick]=useState(0);
  const key=scopeKey({platform,days});
  useEffect(()=>{
    setEntry(null);setError('');setLoading(true);
    const c=new AbortController();
    fetchCommercialManager('/api/admin/commerce/strategic-view?platform='+platform+'&days='+days,{signal:c.signal})
      .then(d=>{if(!c.signal.aborted)setEntry({key,data:d});})
      .catch(e=>{if(!c.signal.aborted)setError(e.message||'Não foi possível carregar a visão estratégica.');})
      .finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[key,tick]);
  const current=isCurrentScope(entry,key)?entry.data:null;
  // Conta E período devolvidos precisam ser os escolhidos agora; qualquer outra resposta é descartada.
  const v=current&&matchesPlatform(current,platform)&&Number(current.days)===days?current:null;
  const wrong=Boolean(current)&&!v;
  const mv=v?.movements;
  const bad=v?Object.entries(v.parts).filter(([,s])=>s==='INDISPONIVEL'||s==='RESPOSTA_INVALIDA'):[];
  return <section className="nsv-root" aria-label="Visão estratégica">
    <div className="nsv-toolbar">
      <div className="nsv-seg" role="radiogroup" aria-label="Conta">
        {STRATEGIC_PLATFORMS.map(p=><button key={p.id} type="button" role="radio" aria-checked={platform===p.id} className={platform===p.id?'is-active':''}
          style={{'--c':p.color}} onClick={()=>setPlatform(p.id)}><i/>{p.label}</button>)}
      </div>
      <div className="nsv-seg" role="radiogroup" aria-label="Período">
        {STRATEGIC_DAYS.map(d=><button key={d} type="button" role="radio" aria-checked={days===d} className={days===d?'is-active':''} onClick={()=>setDays(d)}>{d} dias</button>)}
      </div>
      <button type="button" className="nsv-refresh" onClick={()=>setTick(t=>t+1)}>Atualizar</button>
    </div>
    <p className="nsv-note">Somente unidades, a partir dos dados importados. Não mostra valores financeiros.</p>
    {error&&<p className="nsv-error" role="alert">{error}</p>}
    {wrong&&<p className="nsv-error" role="alert">A resposta recebida não corresponde à conta ou ao período escolhidos e foi descartada.</p>}
    {loading&&<p className="nsv-note" role="status">Carregando…</p>}
    {v&&<>
      {v.periods&&<p className="nsv-note" data-testid="periods">Período atual: {v.periods.current.start} a {v.periods.current.end} · anterior: {v.periods.previous.start} a {v.periods.previous.end}</p>}
      {v.notices.map(n=><p key={n.kind} className="nsv-warn" role="status" data-notice={n.kind}>{n.text}</p>)}
      {bad.length>0&&<p className="nsv-warn" role="status" data-testid="parts-down">Partes indisponíveis ou descartadas: {bad.map(([k,s])=>(PART_PT[k]||k)+(s==='RESPOSTA_INVALIDA'?' (resposta inválida)':'')).join(', ')}. O restante da tela continua válido.</p>}
      {v.status==='SEM_INFORMACAO'?<p className="nsv-empty">Sem informação de vendas para esta conta.</p>:<>
      <div className="nsv-kpis">
        <div><span>Unidades no período · {BASIS[v.units.basis]}</span><strong data-testid="units-current">{nf(v.units.current)}</strong>{!v.units.verified.current&&<small className="nsv-unv">não verificado</small>}</div>
        <div><span>Período anterior · mesma base</span><strong>{nf(v.units.previous)}</strong>{!v.units.verified.previous&&<small className="nsv-unv">não verificado</small>}</div>
        <div><span>Variação (mesma base)</span><strong>{v.units.change_pct==null?'—':(v.units.change_pct>0?'+':'')+String(v.units.change_pct).replace('.',',')+'%'}</strong>
          {v.units.change_pct==null&&<small>exige os dois períodos verificados</small>}</div>
        <div><span>Anúncios ativos</span><strong>{nf(v.listings.active)}</strong><small className={v.listings.coverage_verified?'':'nsv-unv'} data-testid="no-sales-card">{nf(v.listings.active_without_sales)} {v.listings.active_without_sales_label} · {nf(v.listings.inactive)} inativos</small></div>
      </div>
      {v.units.sku_total&&<p className="nsv-note" data-testid="sku-total">Outra base, não somar: total por SKU no período atual = {nf(v.units.sku_total.current)} un. (inclui {nf(v.units.sku_total.unlinked)} de SKU sem vínculo).</p>}
      <Block title="Produtos campeões (maiores unidades)" notes={['Até '+v.champions_limit+' anúncios, por unidades vendidas no período atual.',v.champions_note]} tone={v.champions_verified?null:'candidate'}>
        {!v.champions_available?<p className="nsv-error" role="status">Consulta indisponível no momento.</p>:v.champions.length===0?<p className="nsv-empty">Sem dados.</p>
          :<ul className="nsv-list">{v.champions.map(r=><Row key={r.listing_id||r.external_id} r={r}/>)}</ul>}</Block>
      <div className="nsv-two">
        <Group g={mv.growth} showPrev partName="overview"/>
        <Group g={mv.drops} showPrev partName="dashboard"/>
      </div>
      <Group g={mv.stopped} partName="overview"/>
      <Group g={mv.never} partName="overview"/>
      <Block title={'Evolução comercial · '+BASIS[v.evolution.basis]}>
        {!v.evolution.available.months&&!v.evolution.available.daily?<p className="nsv-error" role="status">Evolução indisponível no momento.</p>:<>
        {v.evolution.months.length>0&&<><h4>Por mês</h4>{!v.evolution.verified.months&&<p className="nsv-note" data-testid="months-note">Soma dos dias importados: meses marcados têm dias sem informação ou sem verificação; um valor baixo ali não prova ausência de vendas.</p>}<Bars items={v.evolution.months}/></>}
        {v.evolution.daily.length>0&&<><h4>Por dia (período selecionado)</h4>{!v.evolution.verified.daily&&<p className="nsv-note" data-testid="daily-note">Cobertura do período atual não comprovada: dias marcados não provam ausência de vendas.</p>}{!v.evolution.verified.daily_previous&&<p className="nsv-note">Valores do período anterior não verificados.</p>}<Bars items={v.evolution.daily}/></>}
        {v.evolution.months.length===0&&v.evolution.daily.length===0&&<p className="nsv-empty">Sem dados.</p>}</>}</Block>
      <Block title="Categorias e coleções"
        notes={v.categories?['Unidades · '+BASIS[v.categories.basis]+'.',
          'Comparação anual: período atual '+v.categories.period.current.start+' a '+v.categories.period.current.end+' contra o mesmo período do ano anterior ('+v.categories.period.base.start+' a '+v.categories.period.base.end+').',
          !v.categories.aligned?'Este período não é o mesmo das demais seções.':null,
          (!v.categories.verified.current||!v.categories.verified.base)?'Valores não verificados (cobertura não comprovada).':null]:[]}>
        {v.categories==null?<p className={v.parts.categories==='SEM_DADOS'?'nsv-empty':'nsv-error'} role="status">{v.parts.categories==='SEM_DADOS'?'Sem dados.':'Categorias indisponíveis no momento.'}</p>
          :v.categories.items.length===0?<p className="nsv-empty">Sem dados.</p>
          :<ul className="nsv-list">{v.categories.items.map(c=><li key={c.name} className="nsv-row"><div><b>{c.name}</b>
            {c.collections.length>0&&<small className="nsv-cols">{c.collections.map(x=>x.name+' '+nf(x.units)).join(' · ')}</small>}</div>
            <div className="nsv-nums"><span>{nf(c.units)} un.</span><small>ano anterior {nf(c.base)}</small></div></li>)}</ul>}</Block>
      <Block title="Vendas sem vínculo e resíduo">
        {v.sales_split.kind==='SHOPEE'
          ?(v.sales_split.total==null?<p className={v.sales_split.status==='INDISPONIVEL'?'nsv-error':'nsv-empty'} role="status">{v.sales_split.status==='INDISPONIVEL'?'Consulta indisponível no momento.':'Sem informação para este período.'}</p>
            :<dl className="nsv-dl"><div><dt>Total por SKU</dt><dd>{nf(v.sales_split.total)}</dd></div><div><dt>Com vínculo a anúncio</dt><dd>{nf(v.sales_split.linked)}</dd></div>
              <div><dt>Sem vínculo</dt><dd>{nf(v.sales_split.unlinked)}</dd></div><div><dt>Outras causas explicadas</dt><dd>{nf(v.sales_split.other_explained)}</dd></div>
              <div><dt>Resíduo não explicado</dt><dd>{nf(v.sales_split.residual)}</dd></div></dl>)
          :<p>{nf(v.sales_split.unlinked_listings)} anúncio(s) vendendo sem SKU vinculado.</p>}
        {v.sales_split.status==='INCONSISTENTE'&&<p className="nsv-warn">Os números não fecham entre si: conferir antes de usar.</p>}
      </Block></>}
      {!v.traffic_available&&<p className="nsv-note">Visitas, impressões e conversão: sem relatório importado desta conta.</p>}
      <p className="nsv-note nsv-sources" data-testid="sources">{v.sources.note}{v.sources.elapsed_ms!=null&&' Montada em '+nf(v.sources.elapsed_ms)+' ms.'}</p>
      {v.validation.limitations.length>0&&<p className="nsv-note nsv-sources" data-testid="limitations">Conferência de origem limitada: {v.validation.limitations.join(' ')}</p>}
    </>}
  </section>;
}
