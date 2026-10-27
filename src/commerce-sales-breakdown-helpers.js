// Variacao percentual (1 casa) entre dois periodos; null quando nao ha base de comparacao.
export const deltaPct=(cur,prev)=>Number(prev)>0?Math.round((Number(cur)-Number(prev))/Number(prev)*1000)/10:null;
