import React,{useEffect,useState} from 'react';
import {commerceApi} from './commerce-admin-api.js';
import {analyzeTrafficWindow,trafficDerivedRates} from './commerce-traffic-analysis.js';
import './commerce-traffic-metrics.css';

const N=new Intl.NumberFormat('pt-BR');
const fmt=n=>n==null?'—':N.format(Number(n));
const percent=n=>n==null?'—':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(n*100)+'%';
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s.split('-').reverse().join('/'):'—';
const scopes=[['ALL','Tráfego total'],['ORGANIC','Orgânico'],['PAID','Publicidade paga']];
const emptyValues={visits:'',impressions:'',clicks:'',orders:''};
const digits=s=>/^\d{0,13}$/.test(s);

function Metrics({title,record}) {
  const rates=trafficDerivedRates(record);
  return <div className="nim-traffic-period">
    <strong>{title}</strong>
    {record?<><div className="nim-traffic-numbers">
      <div><small>Visitas</small><b>{fmt(record.visits)}</b></div>
      <div><small>Impressões</small><b>{fmt(record.impressions)}</b></div>
      <div><small>Cliques</small><b>{fmt(record.clicks)}</b></div>
      <div><small>Pedidos atribuídos no relatório</small><b>{fmt(record.orders)}</b></div>
      <div><small>CTR</small><b>{percent(rates.ctr)}</b></div>
      <div><small>Pedidos / visitas</small><b>{percent(rates.conversion)}</b></div>
    </div><small className="nim-traffic-source">Fonte informada: {record.source} · registrado em {new Date(record.recorded_at).toLocaleDateString('pt-BR')}</small></>
      :<p className="nim-traffic-empty">Sem relatório deste período e escopo.</p>}
  </div>;
}

export default function CommerceTrafficMetrics({listingId,start,end}) {
  const [data,setData]=useState(null),[loading,setLoading]=useState(false);
  const [error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [scope,setScope]=useState('ALL'),[entryOpen,setEntryOpen]=useState(false);
  const [windowName,setWindowName]=useState('current'),[source,setSource]=useState('');
  const [values,setValues]=useState(emptyValues),[saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');
  const validDates=/^\d{4}-\d{2}-\d{2}$/.test(start||'')&&/^\d{4}-\d{2}-\d{2}$/.test(end||'');
  useEffect(()=>{
    if(!validDates||!listingId){setData(null);return;}
    const ctrl=new AbortController();setLoading(true);setError('');setData(null);
    const qs=new URLSearchParams({start,end});
    commerceApi('/api/admin/commerce/listings/manager/'+encodeURIComponent(listingId)+'/traffic?'+qs,
      {signal:ctrl.signal,cache:'no-store'})
      .then(result=>{if(!ctrl.signal.aborted)setData(result);})
      .catch(err=>{if(!ctrl.signal.aborted)setError(err.message);})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[listingId,start,end,revision,validDates]);
  const current=data?.current?.[scope]||null;
  const previous=data?.previous?.[scope]||null;
  const analysis=analyzeTrafficWindow(current,previous);
  const entryStart=windowName==='previous'?data?.previous_start:start;
  const entryEnd=windowName==='previous'?data?.previous_end:end;
  async function save(e) {
    e.preventDefault();setMessage('');setError('');
    if(!data){setError('Carregue os períodos antes de registrar dados.');return;}
    if(source.trim().length<8){setError('Informe a identificação do relatório de origem.');return;}
    const payload={start:entryStart,end:entryEnd,scope,source:source.trim()};
    for(const key of Object.keys(emptyValues)){
      const raw=String(values[key]||'').trim();
      payload[key]=raw===''?null:Number(raw);
      if(raw!==''&&(!digits(raw)||!Number.isSafeInteger(payload[key]))) {
        setError('Use somente números inteiros não negativos.');return;
      }
    }
    if(Object.keys(emptyValues).every(k=>payload[k]===null)){
      setError('Informe ao menos uma métrica do relatório.');return;
    }
    if(payload.clicks!=null&&payload.impressions!=null&&payload.clicks>payload.impressions){
      setError('Cliques não podem superar impressões.');return;
    }
    setSaving(true);
    try{
      await commerceApi('/api/admin/commerce/listings/manager/'+encodeURIComponent(listingId)+'/traffic',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
      });
      setEntryOpen(false);setSource('');setValues(emptyValues);setRevision(n=>n+1);
      setMessage('Relatório registrado para a janela e tipo de tráfego selecionados.');
    }catch(e){setError(e.message)}
    finally{setSaving(false)}
  }
  return <section className="nim-traffic" aria-label="Métricas reais de tráfego por anúncio">
    <div className="nim-traffic-header"><div><h4>Tráfego e conversão</h4>
      <p>Dados de relatório externo, não estimativas do NISTI.</p></div>
      <label>Tipo de tráfego<select value={scope} onChange={e=>{setScope(e.target.value);setMessage('');}}>
        {scopes.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {!validDates&&<p className="nim-traffic-empty">As datas exatas deste período não estão disponíveis.</p>}
    {loading&&<p className="nim-traffic-empty" role="status">Consultando relatórios…</p>}
    {error&&<p className="nim-traffic-error" role="alert">{error}</p>}
    {message&&<p className="nim-traffic-success" role="status">{message}</p>}
    {data&&!loading&&<><div className="nim-traffic-compare">
      <Metrics title={'Atual · '+date(data.period_start)+' a '+date(data.period_end)} record={current}/>
      <Metrics title={'Anterior · '+date(data.previous_start)+' a '+date(data.previous_end)} record={previous}/>
    </div>
      <div className="nim-traffic-insights">
        <strong>{analysis.headline}</strong>
        {analysis.evidence.length>0?analysis.evidence.map(x=><p key={x.key} className={x.type==='drop'?'drop':''}>
          <b>{x.label}.</b> {x.text}</p>)
          :<p>{current&&previous?'Os critérios mínimos não apontaram uma queda relevante ou as métricas informadas são insuficientes.':analysis.notice}</p>}
      </div>
      <p className="nim-traffic-caution">Análise exclusiva de {scopes.find(x=>x[0]===scope)?.[1].toLowerCase()}.
        Somente métricas presentes no mesmo relatório são comparadas. A origem informada não foi verificada automaticamente.</p>
      <button type="button" className="nim-traffic-entry-toggle" aria-expanded={entryOpen}
        onClick={()=>setEntryOpen(o=>!o)}>{entryOpen?'Fechar registro de relatório':'Registrar métricas de relatório'}</button>
      {entryOpen&&<form className="nim-traffic-entry" onSubmit={save}>
        <p>Transcreva os valores do relatório oficial do marketplace, selecionando o mesmo intervalo e escopo.
          Use a referência do arquivo para auditoria. Uma nova entrada substitui a anterior dessa mesma janela.</p>
        <label>Período<select value={windowName} onChange={e=>setWindowName(e.target.value)}>
          <option value="current">Atual · {date(start)} a {date(end)}</option>
          <option value="previous">Anterior · {date(data.previous_start)} a {date(data.previous_end)}</option>
        </select></label>
        <label>Origem / nome do relatório<input value={source} onChange={e=>setSource(e.target.value)}
          maxLength={200} required placeholder="Ex.: exportação visitas Shopee 2026-10" /></label>
        <div className="nim-traffic-entry-numbers">
          {Object.keys(emptyValues).map(key=><label key={key}>{{
            visits:'Visitas',impressions:'Impressões',clicks:'Cliques',orders:'Pedidos atribuídos'
          }[key]}<input type="number" inputMode="numeric" min="0" max="1000000000000" step="1"
            value={values[key]} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}
            placeholder="Não informado"/></label>)}
        </div>
        <button type="submit" disabled={saving}>{saving?'Registrando…':'Salvar métricas'}</button>
      </form>}
    </>}
  </section>;
}
