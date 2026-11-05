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
      semVendas:pick('SEM_VENDAS'),parou:pick('PAROU'),
      zero:mine.filter(r=>r.scope==='ANUNCIO'),vars:mine.filter(r=>r.scope==='VARIACAO')};
  }).filter(g=>g.total>0);
}
export const PERIOD_CHOICES=[[7,'Até 7 dias'],[30,'Até 30 dias'],[60,'Até 60 dias'],[90,'Até 90 dias']];
export function periodLabel(days){
  return 'Sem vender há até '+Number(days)+' dias';
}

export const SUMMARY_LIMIT=10;
// Os que estão há mais tempo sem vender primeiro (nunca vendeu = mais tempo).
export function topLongest(rows,n=SUMMARY_LIMIT){
  const d=r=>r.days_since==null?Infinity:Number(r.days_since);
  return [...(rows||[])].sort((a,b)=>d(b)-d(a)||String(a.title||'').localeCompare(String(b.title||''),'pt-BR')).slice(0,n);
}

const csvCell=v=>{const t=v==null?'':String(v);return /[;"\n\r]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;};
// Planilha para Excel brasileiro: separador ponto e vírgula e BOM para acentos.
export function reportToCsv(rows){
  const head=['Plataforma','Vendeu antes?','Tipo','ID do anúncio','Título','Variação','SKU','Última venda','Dias sem vender','Unidades vendidas (histórico)','Link'];
  const lines=(rows||[]).map(r=>[PLATFORM_LABELS[r.platform]||r.platform,(Number(r.units_ever)>0?'Sim':'Nunca'),SCOPE_LABELS[r.scope]||r.scope,
    r.external_id,r.title,r.variation_name,r.sku,r.last_sale,r.days_since,r.units_ever,r.url].map(csvCell).join(';'));
  return '\ufeff'+[head.join(';'),...lines].join('\r\n');
}

// Uma linha por anúncio: as variações do mesmo anúncio viram uma lista só.
export function groupListings(rows){
  const map=new Map();
  for(const r of rows||[]){
    const k=r.platform+'|'+r.scope+'|'+r.external_id;
    let g=map.get(k);
    if(!g){g={key:k,scope:r.scope,external_id:r.external_id,title:r.title,url:r.url,days_since:r.days_since,units_ever:0,vars:[],listing_variations:r.listing_variations};map.set(k,g);}
    if(r.scope==='VARIACAO'&&r.variation_name)g.vars.push(r.variation_name);
    // Em anúncio com várias variações, vale a venda mais recente entre elas; 'nunca' só se nenhuma vendeu.
    if(r.days_since!=null)g.days_since=g.days_since==null?Number(r.days_since):Math.min(Number(g.days_since),Number(r.days_since));
    g.units_ever=Math.max(g.units_ever,Number(r.units_ever)||0);
  }
  return [...map.values()];
}

export function sortItems(items){return topLongest(items,Infinity);}
