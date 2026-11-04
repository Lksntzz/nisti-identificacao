// Periodos futuros e meses sem cobertura sao nulos, nunca vendas iguais a zero.
export function familyMetricTotals(months,metric='units'){
  const suffix=metric==='revenue'?'revenue':'units';
  const rows=Array.isArray(months)?months:[];
  const cur=rows.filter(row=>row['cur_'+suffix]!=null);
  const base=rows.filter(row=>row['base_'+suffix]!=null);
  const sum=(list,key)=>list.reduce((total,row)=>total+Number(row[key]||0),0);
  const best=cur.filter(row=>Number(row['cur_'+suffix])>0)
    .sort((a,b)=>Number(b['cur_'+suffix])-Number(a['cur_'+suffix])||Number(a.month)-Number(b.month))[0]||null;
  return {base:sum(base,'base_'+suffix),cur:sum(cur,'cur_'+suffix),best};
}

// O resumo geral inclui todas as vendas; o detalhe por família só usa vínculos confirmados.
export function familyReportMonths(report,familyId=''){
  const rows=familyId?report?.months:report?.overall_months;
  return Array.isArray(rows)?rows:[];
}

export function canLinkFamilyProduct(family,product){
  if(!family||!product||product.family_id!=null)return false;
  return product.category_id==null||Number(product.category_id)===Number(family.category_id);
}

// O SQL devolve vendas por mes; o cliente so agrega quando o operador escolhe ano inteiro.
export function familyDetailsByMonth(rows,month=null){
  const source=Array.isArray(rows)?rows:[];
  if(month!=null&&month!=='')return source.filter(row=>Number(row.month)===Number(month));
  const entries=new Map();
  for(const row of source){
    const key=JSON.stringify([row.product_id,row.sku,row.platform,row.listing_id]);
    if(!entries.has(key))entries.set(key,{...row,month:null,cur_units:0,base_units:0,cur_revenue:0,base_revenue:0});
    const result=entries.get(key);
    for(const column of ['cur_units','base_units','cur_revenue','base_revenue'])result[column]+=Number(row[column]||0);
  }
  return [...entries.values()].sort((a,b)=>b.cur_units-a.cur_units||String(a.product_name).localeCompare(String(b.product_name),'pt-BR'));
}
