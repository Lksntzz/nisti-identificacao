// Lógica pura do relatório de anúncios sem vendas (agrupamento por plataforma).
export const PLATFORM_LABELS={SHOPEE:'Shopee',ML_ANTIGO:'Mercado Livre (antigo)',ML_NOVO:'Mercado Livre (novo)'};
export const PLATFORM_ORDER=['SHOPEE','ML_ANTIGO','ML_NOVO'];
export const SCOPE_LABELS={ANUNCIO:'ANÚNCIO TODO',VARIACAO:'VARIAÇÃO'};
export const SITUATION_LABELS={SEM_VENDAS:'Sem vendas',PAROU:'Vendia e parou'};

export function groupReport(rows){
  const list=Array.isArray(rows)?rows:[];
  return PLATFORM_ORDER.map(code=>{
    const mine=list.filter(r=>r.platform===code);
    const pick=(sit)=>mine.filter(r=>r.situation===sit).sort((a,b)=>
      (a.scope===b.scope?0:a.scope==='ANUNCIO'?-1:1)||
      (Number(b.days_since??-1)-Number(a.days_since??-1))||String(a.title||'').localeCompare(String(b.title||''),'pt-BR'));
    return {code,label:PLATFORM_LABELS[code],total:mine.length,
      anuncios:mine.filter(r=>r.scope==='ANUNCIO').length,
      variacoes:mine.filter(r=>r.scope==='VARIACAO').length,
      semVendas:pick('SEM_VENDAS'),parou:pick('PAROU')};
  }).filter(g=>g.total>0);
}
export function periodLabel(days,month){
  if(month)return /^\d{4}$/.test(month)?'Ano '+month:month.slice(5)+'/'+month.slice(0,4);
  return Number(days)===0?'Todo o histórico':'Últimos '+Number(days)+' dias';
}
