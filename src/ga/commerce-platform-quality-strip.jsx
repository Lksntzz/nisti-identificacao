import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {requestKey} from './commerce-data-quality-logic.js';
import {qualityStrip,matchesPlatform,isCurrentScope,makeEntry,platformLabel} from './commerce-platform-scope-logic.js';
import './commerce-platform-scope.css';

// GA-012 — resumo compacto da GA-018 da conta escolhida. O período é o MESMO que o dashboard analisa (ou é dito explicitamente).
// Carrega separado (só depois que o dashboard principal chegou) e falha em silêncio. Não existe versão consolidada.
export function usePlatformQuality({platform,period,ready}){
  const single=platform!=='TODAS';
  const key=period?requestKey(platform,period.start,period.end,false):'';
  const [entry,setEntry]=useState(null);
  const [failed,setFailed]=useState(null);
  useEffect(()=>{
    setEntry(null);setFailed(null);
    if(!single||!ready||!period)return undefined;
    const c=new AbortController();
    fetchCommercialManager('/api/admin/commerce/data-quality?platform='+platform+'&start='+period.start+'&end='+period.end,{signal:c.signal})
      .then(d=>{if(!c.signal.aborted&&matchesPlatform(d,platform))setEntry(makeEntry(key,d));})
      .catch(()=>{if(!c.signal.aborted)setFailed(key);});
    return()=>c.abort();
  },[key,single,ready]);
  return {key,dq:isCurrentScope(entry,key)?entry.data:null,failed:failed===key&&Boolean(key)};
}

export default function PlatformQualityStrip({platform,period,quality,onOpenQuality}){
  if(platform==='TODAS')return null;
  const s=qualityStrip(quality?.dq);
  return <div className="ndb-qstrip" role="group" aria-label={'Qualidade dos dados · '+platformLabel(platform)} data-quality-platform={platform} data-quality-differs={period?.differs?'1':'0'}>
    {s?<>
      <span>Última venda <b>{s.last}</b></span>
      <span className={'ndb-qpill is-'+s.freshTone}>Vendas: {s.fresh}</span>
      <span className={'ndb-qpill is-'+s.reconTone} title={s.reconSub||undefined}>Conciliação interna: {s.recon}</span>
    </>:<span className="ndb-qmuted">{quality?.failed?'Qualidade dos dados indisponível agora.':'Qualidade dos dados: consultando…'}</span>}
    {period&&<span className={'ndb-qmuted ndb-qperiod'+(period.differs?' is-differs':'')} data-quality-period>Período do resumo: {period.label}</span>}
    {onOpenQuality&&<button type="button" className="ndb-qlink" onClick={onOpenQuality}>Ver qualidade dos dados</button>}
  </div>;
}
