import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {STRATEGIC_PLATFORMS,STRATEGIC_DAYS} from './commerce-strategic-logic.js';
import {scopeKey,isCurrentScope,matchesPlatform} from './commerce-platform-scope-logic.js';
import './commerce-strategic-view.css';

// GA-013 — Visão estratégica por conta (somente leitura). Só unidades: nada de faturamento, lucro, margem ou ticket.
// GA-012: a resposta fica guardada com a chave conta|período e é descartada se não for a escolha atual.
const nf=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const LABEL={CRESCIMENTO:'Crescimento',QUEDA:'Queda',ESTAVEL:'Estável',POUCO_VOLUME:'Pouco volume',PAROU:'Parou',NUNCA_VENDEU:'Nunca vendeu',
  SEM_VENDAS_HISTORICO_NAO_VERIFICADO:'Sem vendas no histórico importado (não verificado)',SEM_VENDA_NO_PERIODO:'Sem venda no período',SEM_CLASSIFICACAO:'Sem classificação'};
const REASON={PERIODO_ATUAL_NAO_COMPROVADO:'cobertura do período atual não comprovada',PERIODO_ANTERIOR_NAO_COMPROVADO:'cobertura do período anterior não comprovada',
  HISTORICO_NAO_COMPROVADO:'histórico não verificado'};

function Traffic({t}){
  if(!t||(t.visits==null&&t.impressions==null&&t.conversion_pct==null))return null;
  return <small className="nsv-traffic">{t.visits!=null&&<>Visitas {nf(t.visits)}</>}{t.impressions!=null&&<> · Impressões {nf(t.impressions)}</>}
    {t.conversion_pct!=null&&<> · Conversão {String(t.conversion_pct).replace('.',',')}%</>}{t.period&&<> ({t.period.start} a {t.period.end})</>}</small>;
}
function Row({r,showPrev}){
  return <li className="nsv-row"><div><b>{r.title||r.external_id||'Anúncio'}</b>{r.external_id&&<small> {r.external_id}</small>}<Traffic t={r.traffic}/></div>
    <div className="nsv-nums">{r.units!=null&&<span>{nf(r.units)} un.</span>}{showPrev&&r.units_previous!=null&&<small>antes {nf(r.units_previous)}</small>}
      {r.label&&<em className={'nsv-tag is-'+r.label.toLowerCase()} title={REASON[r.reason]||''}>{LABEL[r.label]||r.label}</em>}</div></li>;
}
function Block({title,note,children,empty}){
  return <section className="nsv-block"><h3>{title}</h3>{note&&<p className="nsv-note">{note}</p>}{empty?<p className="nsv-empty">{empty}</p>:children}</section>;
}
function Bars({items}){
  const max=Math.max(1,...items.map(i=>i.units||0));
  return <ul className="nsv-bars">{items.map(i=><li key={i.month||i.day}><span>{i.month||i.day}</span><i style={{width:Math.round((i.units||0)/max*100)+'%'}}/><b>{nf(i.units)}</b></li>)}</ul>;
}

export default function CommerceStrategicView(){
  const [platform,setPlatform]=useState('SHOPEE');
  const [days,setDays]=useState(7);
  const [entry,setEntry]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [tick,setTick]=useState(0);
  const [showAllNever,setShowAllNever]=useState(false);
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
  const v=isCurrentScope(entry,key)&&matchesPlatform(entry.data,platform)?entry.data:null;
  const mv=v?.movements;
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
    <p className="nsv-note">Somente unidades vendidas, a partir dos dados importados. Não mostra faturamento, lucro, margem nem ticket médio.</p>
    {error&&<p className="nsv-error" role="alert">{error}</p>}
    {loading&&<p className="nsv-note">Carregando…</p>}
    {v&&<>
      {v.periods&&<p className="nsv-note">Período atual: {v.periods.current.start} a {v.periods.current.end} · anterior: {v.periods.previous.start} a {v.periods.previous.end}</p>}
      {v.notices.map(n=><p key={n.kind} className="nsv-warn" role="status">{n.text}</p>)}
      {v.status==='SEM_INFORMACAO'?<p className="nsv-empty">Sem informação de vendas para esta conta.</p>:<>
      <div className="nsv-kpis">
        <div><span>Unidades no período</span><strong>{nf(v.units.current)}</strong>{!v.units.verified.current&&<small className="nsv-unv">não verificado</small>}</div>
        <div><span>Período anterior</span><strong>{nf(v.units.previous)}</strong>{!v.units.verified.previous&&<small className="nsv-unv">não verificado</small>}</div>
        <div><span>Variação</span><strong>{v.units.change_pct==null?'—':(v.units.change_pct>0?'+':'')+String(v.units.change_pct).replace('.',',')+'%'}</strong>
          {v.units.change_pct==null&&<small>exige os dois períodos verificados</small>}</div>
        <div><span>Anúncios ativos</span><strong>{nf(v.listings.active)}</strong><small>{nf(v.listings.active_without_sales)} sem venda · {nf(v.listings.inactive)} inativos</small></div>
      </div>
      <Block title="Produtos campeões" empty={v.champions.length===0&&'Sem dados.'}><ul className="nsv-list">{v.champions.map(r=><Row key={r.listing_id||r.external_id} r={r}/>)}</ul></Block>
      <div className="nsv-two">
        <Block title="Crescimento" empty={mv.growth.length===0&&'Nenhum anúncio.'}><ul className="nsv-list">{mv.growth.map(r=><Row key={r.listing_id||r.external_id} r={r} showPrev/>)}</ul></Block>
        <Block title="Queda" empty={mv.drops.length===0&&'Nenhum anúncio.'}><ul className="nsv-list">{mv.drops.map(r=><Row key={r.listing_id||r.external_id} r={r} showPrev/>)}</ul></Block>
      </div>
      <Block title={'Anúncios que pararam'+(mv.stopped.total!=null?' ('+nf(mv.stopped.total)+')':'')} note={!mv.stopped.verified?'Parada não verificada: o período atual não está comprovado.':'A data da última venda ainda não foi verificada em todo o histórico.'} empty={mv.stopped.items.length===0&&'Nenhum anúncio.'}>
        <ul className="nsv-list">{mv.stopped.items.map(r=><Row key={r.listing_id||r.external_id} r={r}/>)}</ul></Block>
      <Block title={'Anúncios que nunca venderam'+(mv.never.total!=null?' ('+nf(mv.never.total)+')':'')} note={!mv.never.verified?'Histórico não verificado: estes anúncios não têm venda nos dados importados, mas “nunca vendeu” não é afirmado.':null} empty={mv.never.items.length===0&&'Nenhum anúncio.'}>
        <ul className="nsv-list">{(showAllNever?mv.never.items:mv.never.items.slice(0,10)).map(r=><Row key={r.listing_id||r.external_id} r={r}/>)}</ul>
        {mv.never.items.length>10&&<button type="button" className="nsv-link" onClick={()=>setShowAllNever(s=>!s)}>{showAllNever?'Mostrar menos':'Mostrar todos ('+mv.never.items.length+')'}</button>}</Block>
      <Block title="Evolução comercial" empty={v.evolution.months.length===0&&v.evolution.daily.length===0&&'Sem dados.'}>
        {v.evolution.months.length>0&&<><h4>Por mês</h4><Bars items={v.evolution.months}/></>}
        {v.evolution.daily.length>0&&<><h4>Por dia (período selecionado)</h4><Bars items={v.evolution.daily}/></>}</Block>
      <Block title="Categorias e coleções" empty={v.categories==null?'Categorias indisponíveis no momento.':v.categories.items.length===0&&'Sem dados.'}>
        {v.categories&&<ul className="nsv-list">{v.categories.items.map(c=><li key={c.name} className="nsv-row"><div><b>{c.name}</b>
          {c.collections.length>0&&<small className="nsv-cols">{c.collections.map(x=>x.name+' '+nf(x.units)).join(' · ')}</small>}</div>
          <div className="nsv-nums"><span>{nf(c.units)} un.</span><small>antes {nf(c.previous)}</small></div></li>)}</ul>}</Block>
      <Block title="Vendas sem vínculo e resíduo">
        {v.sales_split.kind==='SHOPEE'
          ?(v.sales_split.total==null?<p className="nsv-empty">Sem informação para este período.</p>
            :<dl className="nsv-dl"><div><dt>Total vendido</dt><dd>{nf(v.sales_split.total)}</dd></div><div><dt>Com vínculo</dt><dd>{nf(v.sales_split.linked)}</dd></div>
              <div><dt>Sem vínculo</dt><dd>{nf(v.sales_split.unlinked)}</dd></div><div><dt>Outras causas explicadas</dt><dd>{nf(v.sales_split.other_explained)}</dd></div>
              <div><dt>Resíduo não explicado</dt><dd>{nf(v.sales_split.residual)}</dd></div></dl>)
          :<p>{nf(v.sales_split.unlinked_listings)} anúncio(s) vendendo sem SKU vinculado.</p>}
        {v.sales_split.status==='INCONSISTENTE'&&<p className="nsv-warn">Os números não fecham entre si: conferir antes de usar.</p>}
      </Block></>}
      {!v.traffic_available&&<p className="nsv-note">Visitas, impressões e conversão: sem relatório importado desta conta.</p>}
    </>}
  </section>;
}
