// Visões dos meses no painel lateral de Categorias. Entrada: lista [{month,cur,base}] do acumulado até hoje.
const n=v=>Number(v)||0;
export const MONTH_VIEWS=[['gain','Ganhos e perdas'],['lost','Não repetiram'],['share','Peso no ano']];

// A: onde mais ganhamos ou perdemos contra o ano anterior (maior diferença absoluta primeiro).
export function gainLoss(list,limit=5){
  return (list||[]).map(m=>({month:m.month,cur:n(m.cur),base:n(m.base),diff:n(m.cur)-n(m.base)}))
    .filter(m=>m.diff!==0).sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff)||a.month-b.month).slice(0,limit);
}
// B: meses fortes do ano anterior que não se repetiram (caíram mais da metade). Maior perda primeiro.
export function notRepeated(list,limit=5){
  return (list||[]).map(m=>({month:m.month,cur:n(m.cur),base:n(m.base)}))
    .filter(m=>m.base>0&&m.cur<m.base*0.5).map(m=>({...m,lost:m.base-m.cur}))
    .sort((a,b)=>b.lost-a.lost||a.month-b.month).slice(0,limit);
}
// C: participação de cada mês no total dos meses já fechados do ano (e do ano anterior, para comparar).
export function yearShare(list,limit=5){
  const rows=(list||[]).map(m=>({month:m.month,cur:n(m.cur),base:n(m.base)}));
  const tc=rows.reduce((a,m)=>a+m.cur,0),tb=rows.reduce((a,m)=>a+m.base,0);
  return rows.map(m=>({...m,shareCur:tc>0?m.cur/tc*100:0,shareBase:tb>0?m.base/tb*100:0}))
    .filter(m=>m.cur>0||m.base>0).sort((a,b)=>b.shareCur-a.shareCur||a.month-b.month).slice(0,limit);
}
