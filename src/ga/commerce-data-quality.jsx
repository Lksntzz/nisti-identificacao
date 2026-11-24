import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import './commerce-data-quality.css';
import {usePrivacy} from './commerce-privacy.js';
import {PLATFORMS,PLATFORM_SHORT,buildCards,groupCards,compactCard,summaryItems,batchRows,presetPeriod,validPeriod,fmtDate,requestKey,isCurrentResult} from './commerce-data-quality-logic.js';

// GA-018 — Central de Qualidade dos Dados (somente leitura; nada aqui altera dados).
// GA-018A — só apresentação: seções, resumo no topo e cartões enxutos; os indicadores são os mesmos.
function Card({card,detail,batches}){
  const [open,setOpen]=useState(detail);
  const [why,setWhy]=useState(detail);
  useEffect(()=>{setOpen(detail);setWhy(detail);},[detail]);
  const isBatches=card.id==='batches';
  const bodyId='ndq-body-'+card.id;
  return <article className={'ndq-card'+(isBatches?' is-wide':'')} data-card={card.id}>
    <header><h4>{card.title}</h4>{card.lastUpdate&&<span className="ndq-last">Última data: {fmtDate(card.lastUpdate)||'—'}</span>}</header>
    <div className="ndq-dims">{card.dims.map(d=><span key={d.label} className={'ndq-pill is-'+d.tone}><b>{d.label}:</b> {d.value}</span>)}</div>
    {isBatches
      ?(batches.length>0&&<table className="ndq-table"><thead><tr><th>Lote</th><th>Arquivo</th><th className="num">Linhas</th><th>Dados até</th><th>Situação</th></tr></thead>
        <tbody>{batches.map(b=><tr key={b.id}><td>#{b.id}</td><td className="file">{b.file}</td><td className="num">{b.rows==null?'—':Number(b.rows).toLocaleString('pt-BR')}</td><td>{fmtDate(b.dataThrough)||'—'}</td><td>{b.status}</td></tr>)}</tbody></table>)
      :(card.primary.length>0&&<dl>{card.primary.map(([k,v],i)=><div key={k+i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>)}
    {card.shortAction&&<div className="ndq-action">
      <p><strong>Ação recomendada:</strong> {card.shortAction}</p>
      {card.actions.length>0&&<button type="button" className="ndq-link" aria-expanded={why} onClick={()=>setWhy(v=>!v)}>{why?'Ocultar motivo':'Ver motivo'}</button>}
      {why&&<ul>{card.actions.map((t,i)=><li key={i}>{t}</li>)}</ul>}
    </div>}
    {card.hasDetails&&<div className="ndq-more">
      <button type="button" className="ndq-link" aria-expanded={open} aria-controls={bodyId} onClick={()=>setOpen(v=>!v)}>{open?'Ocultar detalhes':'Ver detalhes'}</button>
      {open&&<div id={bodyId}>
        {card.more.length>0&&<dl>{card.more.map(([k,v],i)=><div key={k+i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        {card.details.length>0&&<ul>{card.details.map((t,i)=><li key={i}>{t}</li>)}</ul>}
        {card.notes.length>0&&<ul className="ndq-notes">{card.notes.map((t,i)=><li key={i}>{t}</li>)}</ul>}
      </div>}
    </div>}
  </article>;
}

export default function CommerceDataQuality(){
  const initial=presetPeriod('30');
  const [platform,setPlatform]=useState('SHOPEE');
  const [start,setStart]=useState(initial.start);
  const [end,setEnd]=useState(initial.end);
  const [detail,setDetail]=useState(false);
  usePrivacy(); // reavalia os valores em R$ quando o modo privacidade do GA liga/desliga
  const [result,setResult]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [tick,setTick]=useState(0);
  const periodError=validPeriod(start,end);
  const key=requestKey(platform,start,end,detail);
  useEffect(()=>{
    // Ao mudar plataforma/período/detalhe, o resultado anterior some na hora: nunca fica na tela como se fosse do novo pedido.
    setResult(null);setError('');
    if(periodError){setLoading(false);return undefined;}
    const controller=new AbortController();
    setLoading(true);
    fetchCommercialManager('/api/admin/commerce/data-quality?platform='+platform+'&start='+start+'&end='+end+(detail?'&detail=1':''),{signal:controller.signal})
      .then(d=>{if(!controller.signal.aborted)setResult({key,data:d});})
      .catch(e=>{if(!controller.signal.aborted){setResult(null);setError(e.message||'Não foi possível carregar a qualidade dos dados.');}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[key,tick,periodError]);
  const preset=p=>{const r=presetPeriod(p);setStart(r.start);setEnd(r.end);};
  const fresh=!periodError&&!loading&&!error&&isCurrentResult(result,key);
  const data=fresh?result.data:null;
  const cards=buildCards(data).map(compactCard);
  const groups=groupCards(cards);
  const summary=summaryItems(data);
  const batches=batchRows(data);
  return <section className="ndq-root" aria-label="Qualidade dos dados">
    <div className="ndq-toolbar">
      <label>Plataforma
        <select value={platform} onChange={e=>setPlatform(e.target.value)}>
          {PLATFORMS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select></label>
      <label>De<input type="date" value={start} max={end||undefined} onChange={e=>setStart(e.target.value)}/></label>
      <label>Até<input type="date" value={end} min={start||undefined} onChange={e=>setEnd(e.target.value)}/></label>
      <div className="ndq-presets" role="group" aria-label="Períodos rápidos">
        <button type="button" onClick={()=>preset('7')}>7 dias</button>
        <button type="button" onClick={()=>preset('30')}>30 dias</button>
        <button type="button" onClick={()=>preset('90')}>90 dias</button>
        <button type="button" onClick={()=>preset('month')}>Mês atual</button>
      </div>
      <label className="ndq-check"><input type="checkbox" checked={detail} onChange={e=>setDetail(e.target.checked)}/>Mostrar detalhes</label>
      <button type="button" className="ndq-refresh" onClick={()=>setTick(t=>t+1)}>Atualizar</button>
    </div>
    <p className="ndq-disclaimer">Somente leitura. “Conciliado” significa consistência interna entre os arquivos importados: <strong>não prova</strong> que o número bate com o marketplace. Informação ausente aparece como “Sem informação”, nunca como zero.</p>
    {periodError&&<p className="ndq-error">{periodError}</p>}
    {error&&<p className="ndq-error" role="alert">{error}</p>}
    {loading&&<p className="ndq-loading">Carregando…</p>}
    {data&&<p className="ndq-meta">{PLATFORM_SHORT[data.platform]} · {fmtDate(data.period?.start)} a {fmtDate(data.period?.end)} · consultado agora (conciliação e pedidos mensais usam meses inteiros){data.response_ms!=null?' em '+data.response_ms+' ms':''}</p>}
    {summary.length>0&&<div className="ndq-summary" role="list" aria-label="Resumo da qualidade dos dados">
      {summary.map(it=><div key={it.key} role="listitem" className={'ndq-sum is-'+it.tone} title={it.hint}>
        <span className="lbl">{it.label}</span><strong>{it.value}</strong>{it.sub&&<small>{it.sub}</small>}
      </div>)}
    </div>}
    {groups.map(g=><section key={g.id} className="ndq-section" aria-label={g.title}>
      <h3>{g.title}</h3>
      <div className="ndq-grid">{g.cards.map(c=><Card key={c.id} card={c} detail={detail} batches={batches}/>)}</div>
    </section>)}
  </section>;
}
