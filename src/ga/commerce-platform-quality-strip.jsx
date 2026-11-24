import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {requestKey} from './commerce-data-quality-logic.js';
import {qualityPeriod,qualityStrip,matchesPlatform,isCurrentScope,makeEntry,platformLabel} from './commerce-platform-scope-logic.js';
import './commerce-platform-scope.css';

// GA-012 — faixa compacta da GA-018 da conta escolhida. Carrega separado (só depois que o dashboard principal chegou) e falha em silêncio.
// Não existe versão consolidada: com "Consolidado" nada é mostrado.
export default function PlatformQualityStrip({platform,days,month,ready,onOpenQuality}){
  const single=platform!=='TODAS';
  const period=useMemo(()=>qualityPeriod(days,month),[days,month]);
  const key=requestKey(platform,period.start,period.end,false);
  const [entry,setEntry]=useState(null);
  const [failed,setFailed]=useState(null);
  useEffect(()=>{
    setEntry(null);setFailed(null);
    if(!single||!ready)return undefined;
    const c=new AbortController();
    fetchCommercialManager('/api/admin/commerce/data-quality?platform='+platform+'&start='+period.start+'&end='+period.end,{signal:c.signal})
      .then(d=>{if(!c.signal.aborted&&matchesPlatform(d,platform))setEntry(makeEntry(key,d));})
      .catch(()=>{if(!c.signal.aborted)setFailed(key);});
    return()=>c.abort();
  },[key,single,ready]);
  if(!single)return null;
  const s=isCurrentScope(entry,key)?qualityStrip(entry.data):null;
  return <div className="ndb-qstrip" role="group" aria-label={'Qualidade dos dados · '+platformLabel(platform)} data-quality-platform={platform}>
    {s?<>
      <span>Última venda <b>{s.last}</b></span>
      <span className={'ndb-qpill is-'+s.freshTone}>Vendas: {s.fresh}</span>
      <span className={'ndb-qpill is-'+s.reconTone} title={s.reconSub||undefined}>Conciliação interna: {s.recon}</span>
    </>:<span className="ndb-qmuted">{failed===key?'Qualidade dos dados indisponível agora.':'Qualidade dos dados: consultando…'}</span>}
    {onOpenQuality&&<button type="button" className="ndb-qlink" onClick={onOpenQuality}>Ver qualidade dos dados</button>}
  </div>;
}
