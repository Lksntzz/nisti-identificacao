// Regras puras da tela "Desempenho Shopee" (funil por anuncio). Sem rede e sem React: testavel.
export const pct=(a,b)=>{const x=Number(a),y=Number(b);return Number.isFinite(x)&&Number.isFinite(y)&&y>0?x/y*100:null;};
export const deltaPct=(cur,prev)=>{const x=Number(cur),y=Number(prev);return Number.isFinite(x)&&Number.isFinite(y)&&y>0?(x-y)/y*100:null;};
export const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0;};

// Taxas do funil a partir de totais ou de uma linha: CTR = cliques/impressoes; carrinho = quem pos no carrinho/visitantes;
// conversao = pedidos feitos/visitantes (mesma regra do dashboard; pedidos feitos incluem cancelados depois).
export function rates(r){
  return {ctr:pct(r.clicks,r.impressions),cart:pct(r.add_cart,r.visitors),conv:pct(r.orders,r.visitors)};
}
export function funnelSteps(t){
  const x=rates(t||{});
  return [
    {key:'impressions',label:'Impressões',value:num(t?.impressions),note:'Vezes que o anúncio apareceu'},
    {key:'clicks',label:'Cliques',value:num(t?.clicks),rate:x.ctr,rateLabel:'CTR (cliques ÷ impressões)'},
    {key:'visitors',label:'Visitantes',value:num(t?.visitors),rate:pct(t?.visitors,t?.clicks),rateLabel:'visitantes ÷ cliques'},
    {key:'add_cart',label:'Carrinho',value:num(t?.add_cart),rate:x.cart,rateLabel:'carrinho ÷ visitantes'},
    {key:'orders',label:'Pedidos feitos',value:num(t?.orders),rate:x.conv,rateLabel:'conversão (pedidos ÷ visitantes)'}
  ];
}

// Volume minimo para uma taxa merecer atencao (evita marcar anuncio com 3 visitas).
export const MIN_IMPRESSIONS=1000,MIN_VISITORS=200,LOW_RATIO=0.7;
// Etapa em que o anuncio esta mais abaixo da media da loja (regra explicita, sem nota nem veredito).
export function weakStep(row,store){
  const r=rates(row),m=rates(store);
  const cands=[];
  if(num(row.impressions)>=MIN_IMPRESSIONS&&r.ctr!=null&&m.ctr>0)cands.push(['ctr','CTR baixo',r.ctr/m.ctr]);
  if(num(row.visitors)>=MIN_VISITORS&&r.cart!=null&&m.cart>0)cands.push(['cart','Carrinho baixo',r.cart/m.cart]);
  if(num(row.visitors)>=MIN_VISITORS&&r.conv!=null&&m.conv>0)cands.push(['conv','Conversão baixa',r.conv/m.conv]);
  const low=cands.filter(c=>c[2]<LOW_RATIO).sort((a,b)=>a[2]-b[2])[0];
  return low?{key:low[0],label:low[1],ratio:low[2]}:null;
}

export function enrichRows(items,totals){
  return (Array.isArray(items)?items:[]).map(it=>{
    const row={...it};
    const r=rates(it);
    row.ctr=r.ctr;row.cart=r.cart;row.conv=r.conv;
    row.weak=weakStep(it,totals||{});
    row.visitors_delta=it.prev?deltaPct(it.visitors,it.prev.visitors):null;
    row.orders_delta=it.prev?deltaPct(it.orders,it.prev.orders):null;
    row.revenue_delta=it.prev?deltaPct(it.revenue_paid,it.prev.revenue_paid):null;
    return row;
  });
}

export const SORT_KEYS=['revenue_paid','impressions','clicks','ctr','visitors','cart','conv','orders','visitors_delta','revenue_delta'];
export function sortRows(rows,key='revenue_paid',dir='desc'){
  const k=SORT_KEYS.includes(key)?key:'revenue_paid',m=dir==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    const x=a[k],y=b[k];
    if(x==null&&y==null)return String(a.item_id).localeCompare(String(b.item_id));
    if(x==null)return 1;if(y==null)return -1;
    return x===y?String(a.item_id).localeCompare(String(b.item_id)):(x-y)*m;
  });
}
const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
export function filterRows(rows,{q='',weakOnly=false}={}){
  const t=norm(q).trim();
  return rows.filter(r=>(!weakOnly||r.weak)
    &&(!t||norm(r.title).includes(t)||String(r.item_id).includes(t)));
}

const csvCell=v=>{const s=v==null?'':String(v);return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
const dec=(v,d=2)=>v==null?'':Number(v).toFixed(d).replace('.',',');
export function toCsv(rows){
  const head=['ID do item','Anúncio','Impressões','Cliques','CTR %','Visitantes','Carrinho','Carrinho % visitantes','Pedidos feitos','Conversão %','Vendas pagas (R$)','Atenção'];
  const lines=[head.join(';')].concat(rows.map(r=>[r.item_id,r.title,r.impressions,r.clicks,dec(r.ctr),r.visitors,r.add_cart,dec(r.cart),r.orders,dec(r.conv),dec(r.revenue_paid),r.weak?.label||''].map(csvCell).join(';')));
  return '﻿'+lines.join('\r\n');
}
