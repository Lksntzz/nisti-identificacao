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

// Nome de exibição do produto: tira o prefixo da marca e separa a coleção, quando o nome a traz.
export function productLabel(name,sku){
  const raw=String(name||'').trim();
  if(!raw)return {title:'Sem cadastro',collection:'',sku};
  let title=raw.replace(/^nisti\s+print\s+/i,'').replace(/\s{2,}/g,' ').trim();
  let collection='';
  const m=title.match(/\s*[-–]?\s*Cole[cç][aã]o\s+(.+)$/i)||title.match(/\s+-\s+([^-–]+)$/);
  if(m&&m[1]&&m[1].length<=32){collection=m[1].trim();title=title.slice(0,m.index).trim()||title;}
  return {title,collection,sku};
}
// Peso do produto no total do mês, em %.
export const share=(units,total)=>{const t=Number(total||0);return t>0?Number(units||0)/t*100:null;};

// "Novo" de verdade: sem venda no período do ano base E sem nenhuma venda em todo o ano base ("prior.y").
// Sem venda no período mas com venda em outro mês do ano base = "já vendia" (não é lançamento).
// Resposta antiga da API (sem "prior") mantém o comportamento anterior: "novo".
export const newKind=r=>{
  if(!(Number(r?.base)===0&&Number(r?.cur)>0))return null;
  return Number(r?.prior?.y)>0?'old':'new';
};

// Projeção do ano em faixa, por três métodos (nenhum é "o certo"; a faixa mostra a incerteza):
//  recent = o que faltava vender no ano base × ritmo dos últimos 28 dias contra o ano base (método antigo; pessimista se o ano base teve pico recente)
//  year   = o que faltava vender no ano base × ritmo do ano inteiro até agora contra o ano base
//  pace   = ritmo diário dos últimos 28 dias mantido até 31/12, sem sazonalidade
export function projectionRange(k,asOf){
  const cur=Number(k?.cur),base=Number(k?.base),full=Number(k?.base_full),c28=Number(k?.cur28),b28=Number(k?.base28);
  if(!asOf||!Number.isFinite(cur)||!(full>0)||!(base>=0))return null;
  const rest=Math.max(0,full-base);
  const out={};
  if(b28>0&&Number.isFinite(c28))out.recent=Math.round(cur+rest*c28/b28);
  if(base>0)out.year=Math.round(cur+rest*cur/base);
  const y=Number(String(asOf).slice(0,4)),m=Number(String(asOf).slice(5,7)),d=Number(String(asOf).slice(8,10));
  if(Number.isFinite(c28)&&y&&m&&d){
    const left=Math.max(0,Math.round((Date.UTC(y,11,31)-Date.UTC(y,m-1,d))/86400000));
    out.pace=Math.round(cur+left*c28/28);
  }
  const vals=Object.values(out).filter(Number.isFinite);
  if(!vals.length)return null;
  const low=Math.min(...vals),high=Math.max(...vals);
  return {...out,low,high,mid:Math.round((low+high)/2)};
}

// Quantos dias o último dado está atrasado em relação a hoje (datas AAAA-MM-DD). null se alguma data for inválida.
export function daysBehind(asOf,today){
  const t=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10)):null;
  const a=t(asOf),b=t(today);
  return a==null||b==null?null:Math.max(0,Math.round((b-a)/86400000));
}
