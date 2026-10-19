// Shopee financial evidence. Aggregate at order scope BEFORE removing raw
// order IDs. Never transmit buyers, order IDs or addresses to Supabase.
const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const cents=v=>Math.round(Number(v||0)*100);
const money=v=>Number((v/100).toFixed(2));

export function shopeeFinanceColumns(header=[]){
  const keys=header.map(fold);
  const exact=label=>keys.indexOf(fold(label));
  // Z is the item-level discount. AA has the same Portuguese label but can
  // differ and must never be added on top of Z.
  const cols={
    seller_discount:exact('Desconto do vendedor'),
    commission_net:exact('Taxa de comissão líquida'),
    service_net:exact('Taxa de serviço líquida'),
    transaction_fee:exact('Taxa de transação')
  };
  return Object.values(cols).every(v=>v>=0)?cols:null;
}

const valid =x=>x&&['seller_discount','commission_net','service_net','transaction_fee']
  .every(k=>Number.isFinite(x[k])&&Math.abs(x[k])<1e7);

export function aggregateShopeeFinance(lines=[]){
  const orders=new Map();
  for(const item of lines){
    if(!item?.order_id||!item?.sale_date||!item?.sku_norm)continue;
    const month_start=item.sale_date.slice(0,7)+'-01';
    const k=month_start+'\x1f'+item.order_id;
    let group=orders.get(k);
    if(!group){
      group={month_start,date:item.sale_date,skus:new Set(),units:0,
        revenue:0,discount:0,fees:null,feeConflict:false};
      orders.set(k,group);
    }
    group.skus.add(item.sku_norm);
    group.units+=Number(item.units||0);
    group.revenue+=cents(item.product_revenue);
    if(!valid(item.finance)){group.feeConflict=true;continue;}
    group.discount+=cents(item.finance.seller_discount);
    const next={
      commission:cents(item.finance.commission_net),
      service:cents(item.finance.service_net),
      transaction:cents(item.finance.transaction_fee)
    };
    // Commissions in the Shopee export are ORDER-level, duplicated in each
    // product row. If not equal, do not guess and mark fees unreconciled.
    if(group.fees&&Object.keys(next).some(k=>next[k]!==group.fees[k]))
      group.feeConflict=true;
    else if(!group.fees)group.fees=next;
  }
  const daily=new Map(),months=new Map();
  for(const g of orders.values()){
    const m=months.get(g.month_start)||{
      month_start:g.month_start,period_end:g.date,orders:0,units:0,
      product_revenue:0,seller_discount:0,commission_net:0,
      service_net:0,transaction_fee:0,fee_orders:0,
      single_sku_fee_orders:0,unallocated_orders:0,
      unallocated_units:0,unallocated_revenue:0
    };
    if(g.date>m.period_end)m.period_end=g.date;
    m.orders++;m.units+=g.units;m.product_revenue+=g.revenue;
    m.seller_discount+=g.discount;
    const validFees=!!(g.fees&&!g.feeConflict);
    if(validFees){
      m.fee_orders++;
      m.commission_net+=g.fees.commission;
      m.service_net+=g.fees.service;
      m.transaction_fee+=g.fees.transaction;
    }
    if(validFees&&g.skus.size===1){
      m.single_sku_fee_orders++;
      const sku_norm=[...g.skus][0],key=g.date+'\x1f'+sku_norm;
      const d=daily.get(key)||{sale_date:g.date,sku_norm,orders:0,units:0,
        product_revenue:0,seller_discount:0,commission_net:0,
        service_net:0,transaction_fee:0};
      d.orders++;d.units+=g.units;d.product_revenue+=g.revenue;
      d.seller_discount+=g.discount;
      d.commission_net+=g.fees.commission;
      d.service_net+=g.fees.service;
      d.transaction_fee+=g.fees.transaction;
      daily.set(key,d);
    }else{
      // Multi-SKU orders remain in the monthly financial total but their
      // order-level fees are NOT arbitrarily attributed to one listing.
      m.unallocated_orders++;m.unallocated_units+=g.units;
      m.unallocated_revenue+=g.revenue;
    }
    months.set(g.month_start,m);
  }
  function finalize(row){
    const out={...row};
    for(const key of ['product_revenue','seller_discount','commission_net',
      'service_net','transaction_fee','unallocated_revenue'])
      if(key in out)out[key]=money(out[key]);
    return out;
  }
  return {
    finance_month_rows:[...months.values()].map(finalize),
    finance_daily_rows:[...daily.values()].map(finalize),
    finance_summary:{
      orders:orders.size,
      fee_orders:[...months.values()].reduce((n,x)=>n+x.fee_orders,0),
      attributable_orders:[...months.values()].reduce((n,x)=>n+x.single_sku_fee_orders,0)
    }
  };
}
