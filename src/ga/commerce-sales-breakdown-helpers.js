// Variacao percentual (1 casa) entre dois periodos; null quando nao ha base de comparacao.
export const deltaPct=(cur,prev)=>Number(prev)>0?Math.round((Number(cur)-Number(prev))/Number(prev)*1000)/10:null;

const MONTHS=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
export const monthLabel=ym=>{const [y,m]=String(ym||'').split('-');return MONTHS[Number(m)-1]?MONTHS[Number(m)-1]+'/'+String(y).slice(2):String(ym||'');};
// Mes mais vendido (por unidades; empate fica com o mais recente). Mes em andamento marcado para nao enganar.
export function bestMonth(months,lastDay){
  const list=Array.isArray(months)?months:[];
  if(!list.length)return null;
  const best=list.reduce((a,b)=>Number(b.units)>=Number(a.units)?b:a);
  const ongoing=lastDay&&String(lastDay).slice(0,7)===best.month&&String(lastDay).slice(8,10)!==String(new Date(Number(best.month.slice(0,4)),Number(best.month.slice(5,7)),0).getDate()).padStart(2,'0');
  return {...best,ongoing:Boolean(ongoing)};
}
