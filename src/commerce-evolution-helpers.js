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
    else acc.withoutSales++;
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
// Estado do anúncio no período: SOLD (vendeu), ZERO (0 confirmado), PENDING (sem comprovação).
export const adState=(ad,days)=>{
  const units=adUnits(ad,days);
  if(units===null||!ad?.period_end)return 'PENDING';
  return units>0?'SOLD':'ZERO';
};
export const variationState=(v,d,ad)=>{
  if(!v.match_verified)return 'LINK';
  const identified=v?.['identified_'+d];
  if(!known(identified))return 'UNKNOWN';
  if(Number(identified)===0&&Number(ad?.['unlinked_'+d])>0)return 'UNKNOWN';
  return Number(identified)>0?'SOLD':'ZERO';
};
export const adRevenue=(ad,n)=>ad?.period_end&&known(ad?.['revenue_'+n])?Number(ad['revenue_'+n]):null;
