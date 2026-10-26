import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';

// Rotulos honestos: o sinal e correlacao entre preco medio realizado e unidades
// vendidas (janela atual x anterior). Nao prova a causa da variacao.
export const PRICE_SIGNAL_LABELS={
  PRICE_UP_SALES_DOWN:{text:'Preço subiu · vendas caíram',tone:'warn'},
  PRICE_DOWN_SALES_UP:{text:'Preço caiu · vendas subiram',tone:'good'},
  DROP_PRICE_STABLE:{text:'Queda sem mudança de preço',tone:'bad'},
  RISE_PRICE_STABLE:{text:'Alta sem mudança de preço',tone:'good'},
  PRICE_CHANGED_SALES_FLAT:{text:'Preço mudou · vendas estáveis',tone:'neutral'},
  STABLE:{text:'Estável',tone:'neutral'},
  INSUFFICIENT:{text:'Dados insuficientes',tone:'muted'}
};
const MEANING={
  DROP_PRICE_STABLE:'O preço médio não mudou. A queda pode vir de menos visitas, concorrência, estoque, título ou fotos — o sistema ainda não importa visitas.',
  PRICE_UP_SALES_DOWN:'O preço médio subiu e as unidades caíram no mesmo período. É coincidência observada, não prova de causa.',
  INSUFFICIENT:'Poucas vendas nas duas janelas (menos de 10 no total ou menos de 5 na anterior) para comparar com segurança.'
};
const pct=v=>v==null?'—':(v>0?'+':'')+String(v).replace('.',',')+'%';
const brl=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

const DRIVER_FIELD={IMPRESSIONS:'impressions_pct',CTR:'ctr_pct',CONVERSION:'conversion_pct'};
const DRIVER_TEXT={
  DOWN:{IMPRESSIONS:'Menos impressões',CTR:'Menos cliques por impressão',CONVERSION:'Converte menos',OTHER:'Sem causa clara nos dados'},
  UP:{IMPRESSIONS:'Mais impressões',CTR:'Mais cliques por impressão',CONVERSION:'Converte mais',OTHER:'Sem causa clara nos dados'}
};
const fmtDay=v=>String(v||'').slice(0,10).split('-').reverse().join('/');

export function usePriceSignals(rows,days){
  const [signals,setSignals]=useState({});
  const [diagnosis,setDiagnosis]=useState({});
  const ids=(rows||[]).map(r=>r.id).filter(Boolean).join(',');
  const span=[7,30,60,90].includes(Number(days))?Number(days):30;
  useEffect(()=>{
    if(!ids){setSignals({});setDiagnosis({});return undefined;}
    const controller=new AbortController();
    fetchCommercialManager('/api/admin/commerce/listings/manager/performance-diagnosis?ids='+ids,{signal:controller.signal})
      .then(data=>setDiagnosis(data?.diagnosis||{})).catch(()=>{if(!controller.signal.aborted)setDiagnosis({});});
    fetchCommercialManager('/api/admin/commerce/listings/manager/price-signal?days='+span+'&ids='+ids,{signal:controller.signal})
      .then(data=>setSignals(data?.signals||{})).catch(()=>{if(!controller.signal.aborted)setSignals({});});
    return()=>controller.abort();
  },[ids,span]);
  return {signals,diagnosis,window:span};
}

export function PriceSignalCell({signal,window,diagnosis}){
  if(!signal)return <span className="nim-price-signal tone-muted">—</span>;
  const label=PRICE_SIGNAL_LABELS[signal.signal]||PRICE_SIGNAL_LABELS.INSUFFICIENT;
  const title=(MEANING[signal.signal]||'Compara os últimos '+window+' dias com os '+window+' anteriores. Correlação, não prova de causa.')
    +' Preço médio: '+brl(signal.price_previous)+' → '+brl(signal.price_current)+'; unidades: '+signal.units_previous+' → '+signal.units_current+'.';
  const insufficient=signal.signal==='INSUFFICIENT';
  const text=diagnosis&&DRIVER_TEXT[diagnosis.trend]?.[diagnosis.driver];
  const cause=text&&diagnosis.driver!=='INSUFFICIENT'?text+(DRIVER_FIELD[diagnosis.driver]?' ('+pct(diagnosis[DRIVER_FIELD[diagnosis.driver]])+')':''):'';
  const causeTitle=cause?' Causa pelo relatório de desempenho Shopee: '+fmtDay(diagnosis.previous_start)+'–'+fmtDay(diagnosis.previous_end)+' contra '+fmtDay(diagnosis.current_start)+'–'+fmtDay(diagnosis.current_end)+', valores por dia. Indica onde a variação aparece, não prova o motivo.':'';
  return <span className={'nim-price-signal tone-'+label.tone} title={title+causeTitle}>
    <strong>{label.text}</strong>
    {!insufficient&&<small>Preço {pct(signal.price_change_pct)} · Unid. {pct(signal.units_change_pct)}</small>}
    {cause&&<small className={'nim-price-cause tone-'+(diagnosis.trend==='UP'?'good':'bad')}>{cause}</small>}
  </span>;
}
