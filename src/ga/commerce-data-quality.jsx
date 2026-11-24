import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import './commerce-data-quality.css';
import {PLATFORMS,PLATFORM_SHORT,buildCards,presetPeriod,validPeriod,fmtDate} from './commerce-data-quality-logic.js';

// GA-018 — Central de Qualidade dos Dados. Somente leitura: nada aqui altera dados. Sem nota geral de qualidade.
export default function CommerceDataQuality(){
  const initial=presetPeriod('30');
  const [platform,setPlatform]=useState('SHOPEE');
  const [start,setStart]=useState(initial.start);
  const [end,setEnd]=useState(initial.end);
  const [detail,setDetail]=useState(false);
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [tick,setTick]=useState(0);
  const periodError=validPeriod(start,end);
  useEffect(()=>{
    if(periodError){setLoading(false);return undefined;}
    const controller=new AbortController();
    setLoading(true);setError('');
    fetchCommercialManager('/api/admin/commerce/data-quality?platform='+platform+'&start='+start+'&end='+end+(detail?'&detail=1':''),{signal:controller.signal})
      .then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Não foi possível carregar a qualidade dos dados.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[platform,start,end,detail,tick,periodError]);
  const preset=p=>{const r=presetPeriod(p);setStart(r.start);setEnd(r.end);};
  const cards=buildCards(data&&data.platform===platform?data:null);
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
    {data&&!loading&&!error&&<p className="ndq-meta">{PLATFORM_SHORT[data.platform]} · {fmtDate(data.period?.start)} a {fmtDate(data.period?.end)} · consultado agora{data.response_ms!=null?' em '+data.response_ms+' ms':''}</p>}
    <div className="ndq-grid">
      {cards.map(c=><article key={c.id} className="ndq-card">
        <header><h4>{c.title}</h4>{c.lastUpdate&&<span className="ndq-last">Última data: {fmtDate(c.lastUpdate)||'—'}</span>}</header>
        <div className="ndq-dims">{c.dims.map(d=><span key={d.label} className={'ndq-pill is-'+d.tone}><b>{d.label}:</b> {d.value}</span>)}</div>
        {c.lines.length>0&&<dl>{c.lines.map(([k,v],i)=><div key={k+i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        {c.details.length>0&&<details open={detail}><summary>Detalhes ({c.details.length})</summary><ul>{c.details.map((t,i)=><li key={i}>{t}</li>)}</ul></details>}
        {c.notes.length>0&&<ul className="ndq-notes">{c.notes.map((t,i)=><li key={i}>{t}</li>)}</ul>}
        {c.actions.length>0&&<div className="ndq-actions"><strong>Ação recomendada</strong><ul>{c.actions.map((t,i)=><li key={i}>{t}</li>)}</ul></div>}
      </article>)}
    </div>
  </section>;
}
