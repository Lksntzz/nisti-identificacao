// Classificação comercial somente com dados importados e cobertura suficiente.
// Ausência de vínculo Shopee não significa venda zero; não ratear SKUs compartilhados.
const finite=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))
  ?null:Number(value);
export const reportNumber=finite;
export const reportMoney=value=>finite(value)===null?'—':
  new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value));
export const reportUnits=value=>finite(value)===null?'—':
  new Intl.NumberFormat('pt-BR').format(Number(value));
export const percentChange=(current,previous)=>{
  const a=finite(current),b=finite(previous);
  return a===null||b===null||b===0?null:(a-b)/b*100;
};
export function adDiagnosisStatus(item) {
  if(!item)return {code:'PENDING',label:'Dados pendentes',tone:'muted',growth:null};
  const ready=item.ready===true,previous=item.previous_ready===true;
  const units=ready?finite(item.units):null;
  const prev=ready&&previous?finite(item.prev_units):null;
  const growth=ready&&previous?percentChange(units,prev):null;
  const identifiedGrowth=finite(item.identified_growth_pct);
  const hasIdentified=(!ready&&item.source==='SHOPEE'&&finite(item.identified_units)!==null);
  if(ready&&units===0)return {code:'ZERO',label:'Sem vendas',tone:'zero',growth};
  if(ready&&previous&&units!==null&&prev!==null) {
    if(prev===0)return units>0
      ?{code:'NEW',label:'Novas vendas',tone:'rising',growth:null}
      :{code:'ZERO',label:'Sem vendas',tone:'zero',growth:0};
    if(prev<3||Math.abs(units-prev)<2)return {code:'LOW',label:'Baixo volume',tone:'muted',growth};
    if(units>=prev*1.2)return {code:'RISING',label:'Em crescimento',tone:'rising',growth};
    if(units<=prev*.8)return {code:'FALLING',label:'Em queda',tone:'falling',growth};
    return {code:'STABLE',label:'Estável',tone:'stable',growth};
  }
  if(hasIdentified&&identifiedGrowth!==null&&['RISING','FALLING'].includes(item.identified_trend)) {
    const falling=item.identified_trend==='FALLING';
    return {code:item.identified_trend,label:falling?'Queda identificada':'Crescimento identificado',
      tone:falling?'falling':'rising',growth:identifiedGrowth,partial:true};
  }
  if(ready)return {code:'PENDING',label:'Sem comparativo',tone:'muted',growth:null};
  if(hasIdentified&&finite(item.identified_units)>0)
    return {code:'PARTIAL_SOLD',label:'Vendas identificadas',tone:'muted',growth:null,partial:true};
  return {code:'PENDING',label:'Vínculo pendente',tone:'muted',growth:null};
}
export function adPeriodValues(item,days=30){
  const ready=item?.ready===true;
  const partial=item?.source==='SHOPEE'&&!ready;
  const units=ready?finite(item.units):partial?finite(item.identified_units):null;
  const revenue=ready?finite(item.revenue):partial?finite(item.identified_revenue):null;
  const previousUnits=ready&&item?.previous_ready===true
    ?finite(item.prev_units)
    :partial?finite(item.identified_prev_units):null;
  return {units,revenue,previousUnits,partial,days};
}
export function adNoSalesVariantCount(item) {
  if(!item)return null;
  return item.ready===true&&item.variation_data_complete===true
    ?finite(item.zero_variations):null;
}
export function adHasZeroVariationEvidence(item) {
  return (adNoSalesVariantCount(item)||0)>0 ||
    (item?.source==='SHOPEE'&&item?.ready!==true&&Number(item.identified_empty_variations||0)>0);
}
export function adMatchesFilter(item,status) {
  const state=adDiagnosisStatus(item),values=adPeriodValues(item);
  if(status==='ALL')return true;
  if(status==='SOLD')return values.units!==null&&values.units>0;
  if(status==='ZERO')return state.code==='ZERO'||adHasZeroVariationEvidence(item);
  if(status==='STABLE')return state.code==='STABLE';
  if(status==='RISING'||status==='FALLING')return state.code===status;
  return false;
}
export function diagnosisFromEvidence(item,traffic) {
  const status=adDiagnosisStatus(item),primary=traffic?.evidence||[];
  const fallConversion=primary.find(x=>x.key==='conversion'&&x.type==='drop');
  const fallVisits=primary.find(x=>x.key==='visits'&&x.type==='drop');
  const fallCtr=primary.find(x=>x.key==='ctr'&&x.type==='drop');
  const fallImpressions=primary.find(x=>x.key==='impressions'&&x.type==='drop');
  if(fallConversion)return {label:'Conversão do relatório em queda',tone:'falling',
    why:fallConversion.text,evidence:'Comparação de períodos · relatórios do mesmo escopo'};
  if(fallVisits||fallImpressions)return {label:'Alcance ou visitas em queda',tone:'falling',
    why:(fallVisits||fallImpressions).text,evidence:'Comparação de períodos · relatórios do mesmo escopo'};
  if(fallCtr)return {label:'CTR em queda',tone:'falling',why:fallCtr.text,
    evidence:'Comparação de períodos · relatórios do mesmo escopo'};
  if(status.code==='FALLING')return {label:'Vendas em queda · causa a investigar',tone:'falling',
    why:status.partial?'As unidades identificadas diminuíram, mas o vínculo do anúncio é parcial. Não é possível atribuir a causa.':
    'As vendas caíram nos períodos comparáveis. Não há métricas suficientes para afirmar se o problema é tráfego ou conversão.',
    evidence:status.partial?'Evidência parcial por SKU':'Vendas importadas com cobertura'};
  if(status.code==='ZERO')return {label:'Sem vendas atribuídas · causa desconhecida',tone:'zero',
    why:'Verifique exposição, oferta, estoque e conversão. Somente as vendas não revelam por que o anúncio está parado.',
    evidence:'Vendas importadas com cobertura'};
  return {label:'Causa não determinada',tone:'muted',
    why:'Sem métricas comparáveis de tráfego e oferta, o sistema não pode apontar uma causa específica.',
    evidence:'Diagnóstico sujeito à cobertura dos dados'};
}
export const SHORT_DATE=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))
  ?s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4):'—';
