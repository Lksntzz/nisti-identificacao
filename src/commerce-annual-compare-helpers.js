export const growth=(cur,base)=>{const c=Number(cur||0),b=Number(base||0);return b>0?(c-b)/b*100:null;};
export const pctText=p=>p==null?'—':(p>=0?'+':'')+p.toFixed(1).replace('.',',')+'%';

// Índice: 100 = igual ao ano base; 150 = 50% a mais; 55 = 45% a menos. Sem base não existe índice.
export const indexOf=(cur,base)=>{const b=Number(base||0);return b>0?Math.round(Number(cur||0)/b*100):null;};

// Para cada mês: semana que mais vendeu (no ano atual), semana que mais caiu e semana que mais subiu contra o ano base.
// Semana parcial (menos de 7 dias no ano atual) fica fora da disputa de "mais caiu/subiu" para não distorcer.
export function weekHighlights(months){
  return (months||[]).map(m=>{
    const weeks=(m.weeks||[]).map(w=>({...w,index:indexOf(w.cur,w.base),partial:Number(w.days)<(w.n===5?4:7)&&Number(w.days)<7}));
    const full=weeks.filter(w=>w.n<5&&!w.partial&&Number(w.base)>0);
    const best=weeks.reduce((a,w)=>(!a||Number(w.cur)>Number(a.cur)?w:a),null);
    const worst=full.reduce((a,w)=>(!a||w.index<a.index?w:a),null);
    const top=full.reduce((a,w)=>(!a||w.index>a.index?w:a),null);
    const cur=weeks.reduce((s,w)=>s+Number(w.cur),0),base=weeks.reduce((s,w)=>s+Number(w.base),0);
    return {month:m.month,weeks,best,worst,top,cur,base,index:indexOf(cur,base)};
  });
}
