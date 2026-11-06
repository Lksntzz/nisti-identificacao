// Regras puras da ficha do anúncio (Shopee). Sem rede e sem tela, para poder testar.
const num=x=>Number(x)||0;
const has=x=>x!==null&&x!==undefined;

// Semanas com dados de pedido (preço, cancelamento, frete). Sem isso, não entram nas contas.
const withExtras=weeks=>(Array.isArray(weeks)?weeks:[]).filter(w=>w&&w.has_extras&&!w.partial&&num(w.extras_units)>0);

// Mudança de preço: variação de 3% ou mais do preço pago médio entre duas semanas seguidas com dados.
export function priceChanges(weeks,minPct=3){
  const out=[];let prev=null;
  for(const w of (Array.isArray(weeks)?weeks:[])){
    if(!w||!has(w.price_paid_avg)||!w.has_extras)continue;
    const p=num(w.price_paid_avg);
    if(prev&&prev>0&&Math.abs(p-prev)/prev*100>=minPct)out.push({week_start:w.week_start,from:prev,to:p});
    prev=p;
  }
  return out;
}

// Cancelados / (confirmados + cancelados) nas últimas n semanas completas com dados de pedido.
export function cancelRate(weeks,n=4){
  const used=withExtras(weeks).slice(-n);
  const confirmed=used.reduce((a,w)=>a+num(w.extras_units),0);
  const cancelled=used.reduce((a,w)=>a+num(w.cancelled_units),0);
  return confirmed+cancelled>0?{weeks:used.length,cancelled,confirmed,pct:cancelled/(confirmed+cancelled)*100}:null;
}

// O que sobra por unidade antes do custo do produto, nas últimas n semanas completas com dados de pedido.
// frete = estimado menos o que o cliente paga (estimativa: quem paga o resto ainda não foi confirmado).
export function unitEconomics(weeks,n=4){
  const used=withExtras(weeks).slice(-n).filter(w=>has(w.price_paid_avg));
  const units=used.reduce((a,w)=>a+num(w.extras_units),0);
  if(!units)return null;
  const wavg=f=>{
    const rows=used.filter(w=>has(f(w)));
    const u=rows.reduce((a,w)=>a+num(w.extras_units),0);
    return u?rows.reduce((a,w)=>a+num(f(w))*num(w.extras_units),0)/u:null;
  };
  const price=wavg(w=>w.price_paid_avg);
  const listPrice=wavg(w=>w.price_orig_avg);
  const feePct=wavg(w=>w.fee_pct);
  const shipNet=wavg(w=>has(w.ship_est_avg)&&has(w.ship_paid_avg)?num(w.ship_est_avg)-num(w.ship_paid_avg):null);
  const fees=feePct==null?null:price*feePct/100;
  const left=price-(fees||0)-(shipNet||0);
  return {weeks:used.length,units,price,listPrice,feePct,fees,shipNet,left,complete:fees!=null&&shipNet!=null};
}

// Funil por relatório de desempenho (janelas de datas diferentes; podem se sobrepor).
export function funnelRows(funnel){
  return (Array.isArray(funnel)?funnel:[]).map(f=>{
    const v=num(f.visitors);
    return {
      period_start:f.period_start,period_end:f.period_end,visitors:v,
      orders:num(f.orders_placed),impressions:num(f.impressions),
      cartPct:v>0?num(f.add_cart_visitors)/v*100:null,
      convPct:v>0?num(f.orders_placed)/v*100:null
    };
  }).sort((a,b)=>String(a.period_start).localeCompare(String(b.period_start))||String(a.period_end).localeCompare(String(b.period_end)));
}

// Duas janelas se sobrepõem quando uma começa antes de a outra terminar.
export function overlapping(a,b){return a.period_start<=b.period_end&&b.period_start<=a.period_end;}

export function adsRoas(row){return num(row?.spend)>0?num(row.gmv)/num(row.spend):null;}
