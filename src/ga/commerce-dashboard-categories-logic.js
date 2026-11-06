const num=n=>Number(n)||0;

export function pickSummaryYear(coverage,platform){
  const rows=Array.isArray(coverage)?coverage:[];
  const has=(y,plat)=>rows.some(c=>Number(c.year)===y&&num(c.units)>0&&(plat==='TODAS'||c.platform===plat));
  const years=[...new Set(rows.map(c=>Number(c.year)))].filter(y=>y>=2021&&has(y,platform)&&has(y-1,platform)).sort((a,b)=>b-a);
  return years[0]||null;
}

export function summarizeCategories(categories){
  const list=(Array.isArray(categories)?categories:[]).filter(c=>c&&c.name).map(c=>({name:c.name,cur:num(c.cur),base:num(c.base)}));
  const top=[...list].sort((a,b)=>b.cur-a.cur).slice(0,5);
  const diff=c=>c.cur-c.base;
  const rise=[...list].filter(c=>diff(c)>0).sort((a,b)=>diff(b)-diff(a))[0]||null;
  const fall=[...list].filter(c=>diff(c)<0).sort((a,b)=>diff(a)-diff(b))[0]||null;
  return {top,rise,fall,max:Math.max(1,...top.flatMap(c=>[c.cur,c.base]))};
}
