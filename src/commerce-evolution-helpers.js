// Regras de cálculo da Evolução de Vendas (sem React), testáveis isoladamente.
// Princípio: zero só quando os relatórios importados confirmam; senão, pendente.
export const known=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n));

export const observedVariationCounts=(ad,days)=>{
  const variations=Array.isArray(ad?.variations)?ad.variations:[];
  return variations.reduce((acc,v)=>{
    const identified=v?.['identified_'+days];
    if(!v.match_verified||!known(identified)
      ||Number(identified)===0&&Number(ad?.['unlinked_'+days])>0)acc.pending++;
    else if(Number(identified)>0)acc.sold++;
    // "Parada" só com cobertura completa do período; senão faltam relatórios.
    else if(v?.['coverage_'+days]===true)acc.withoutSales++;
    else acc.pending++;
    return acc;
  },{sold:0,withoutSales:0,pending:0});
};
export const adUnits=(ad,n)=>known(ad?.['units_'+n])?Number(ad['units_'+n])
  :ad?.period_end&&known(ad?.['identified_'+n])?Number(ad['identified_'+n]):null;
export const adTrend=ad=>{
  if(!known(ad?.current_window_units)||!known(ad?.previous_window_units))return null;
  const current=Number(ad.current_window_units),previous=Number(ad.previous_window_units);
  return {current,previous,delta:current-previous,
    percent:previous>0?Math.round((current-previous)*1000/previous)/10:null};
};
// Estado do anúncio no período:
//  SOLD        vendeu (venda registrada é fato, mesmo com cobertura parcial)
//  ZERO        0 confirmado: o servidor só envia units_N com cobertura completa
//  UNCONFIRMED 0 registrado, mas faltam dias de relatório para afirmar zero
//  PENDING     plataforma sem relatório importado
export const adState=(ad,days)=>{
  const units=adUnits(ad,days);
  if(units===null||!ad?.period_end)return 'PENDING';
  if(units>0)return 'SOLD';
  return known(ad?.['units_'+days])?'ZERO':'UNCONFIRMED';
};
// Plataformas cujos dados estão parados há mais de maxDays (ou sem dados).
// As janelas de 30/60/90 dias terminam na última venda importada, não hoje.
export const daysBetween=(isoFrom,isoTo)=>{
  const a=Date.parse(isoFrom+'T00:00:00Z'),b=Date.parse(isoTo+'T00:00:00Z');
  return Number.isFinite(a)&&Number.isFinite(b)?Math.round((b-a)/86400000):null;
};
export const staleSources=(coverage,today,maxDays=3)=>
  (Array.isArray(coverage)?coverage:[]).map(c=>({source:c?.source,end_date:c?.end_date||null,
    days_ago:c?.end_date?daysBetween(c.end_date,today):null}))
    .filter(c=>c.end_date===null||c.days_ago===null||c.days_ago>maxDays);
export const todayInSaoPaulo=(now=new Date())=>
  now.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
export const variationState=(v,d,ad)=>{
  if(!v.match_verified)return 'LINK';
  const identified=v?.['identified_'+d];
  if(!known(identified))return 'UNKNOWN';
  if(Number(identified)===0&&Number(ad?.['unlinked_'+d])>0)return 'UNKNOWN';
  if(Number(identified)>0)return 'SOLD';
  return v?.['coverage_'+d]===true?'ZERO':'UNKNOWN';
};
export const adRevenue=(ad,n)=>ad?.period_end&&known(ad?.['revenue_'+n])?Number(ad['revenue_'+n]):null;
