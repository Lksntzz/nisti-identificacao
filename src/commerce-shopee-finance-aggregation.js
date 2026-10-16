// Derive Shopee financial evidence from the official order export before
// removing order IDs. Only aggregate data crosses the API boundary.
const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const moneyCents=value=>Math.round(Number(value||0)*100);
const amount=cents=>Number((cents/100).toFixed(2));

export function shopeeFinanceColumns(headerRow=[]){
  const names=headerRow.map(fold);
  const index=label=>names.indexOf(fold(label));
  // Z is a line discount. AA has the SAME label in the export, and must NOT
  // be summed as another seller discount. AX/AZ are net variants of AW/AY.
  const columns={
    seller_discount:index('Desconto do vendedor'),
    transaction_fee:index('Taxa de transação'),
    commission_net:index('Taxa de comissão líquida'),
    service_net:index('Taxa de serviço líquida')
  };
  return Object.values(columns).every(n=>n>=0)?columns:null;
}

function validFee(x){
  return x && ['seller_discount','transaction_fee','commission_net','service_net']
    .every(key=>Number.isFinite(x[key])&&Math.abs(x[key])<=10000000);
}

export async function aggregateShopeeFinance(raw=[]){
  const groups=new Map();
  for(const row of raw){
    if(!row?.order_id||!row?.sale_date||!row?.sku_norm)continue;
    const month=row.sale_date.slice(0,7)+'-01';
    const key=month+'\x1f'+row.order_id;
    let group=groups.get(key);
    if(!group){
      group={orderKey:key,month,date:row.sale_date,skus:new Set(),units:0,revenue:0,
        discount:0,fees:null,conflicting:false,sourceRows:0};
      groups.set(key,group);
    }
    group.sourceRows++;
    group.skus.add(row.sku_norm);
    group.units+=Number(row.units||0);
    group.revenue+=moneyCents(row.product_revenue);
    if(validFee(row.finance)){
      group.discount+=moneyCents(row.finance.seller_discount);
      const fees={
        transaction:moneyCents(row.finance.transaction_fee),
        commission:moneyCents(row.finance.commission_net),
        service:moneyCents(row.finance.service_net)
      };
      if(group.fees && Object.keys(fees).some(k=>group.fees[k]!==fees[k]))
        group.conflicting=true;
      else if(!group.fees)group.fees=fees;
    }else{
      group.conflicting=true;
    }
  }
  const daily=new Map(),months=new Map();
  for(const order of groups.values()){
    const month=months.get(order.month)||{
      month_start:order.month,data_through:order.date,orders:0,units:0,product_revenue:0,
      seller_discount:0,commission_net:0,service_net:0,transaction_fee:0,
      fee_orders:0,single_sku_fee_orders:0,unallocated_orders:0,
      unallocated_units:0,unallocated_revenue:0
    };
    if(order.date>month.data_through)month.data_through=order.date;
    month.orders++;
    month.units+=order.units;
    month.product_revenue+=order.revenue;
    // Shopee repeats order fees on each product row; even equal values can be
    // either repeated charges or genuine line amounts. Until proven otherwise,
    // recognize fees only for single-line orders; leave all multi-line orders
    // without an assigned fee and expose this explicitly as incomplete coverage.
    const verified=Boolean(order.fees&&!order.conflicting&&order.sourceRows===1);
    if(verified){
      month.fee_orders++;
      month.seller_discount+=order.discount;
      month.commission_net+=order.fees.commission;
      month.service_net+=order.fees.service;
      month.transaction_fee+=order.fees.transaction;
    }
    if(verified&&order.skus.size===1){
      month.single_sku_fee_orders++;
      const sku_norm=[...order.skus][0];
      const key=order.date+'\x1f'+sku_norm;
      const entry=daily.get(key)||{
        sale_date:order.date,sku_norm,orders:0,units:0,product_revenue:0,
        seller_discount:0,commission_net:0,service_net:0,transaction_fee:0
      };
      entry.orders++;
      entry.units+=order.units;
      entry.product_revenue+=order.revenue;
      entry.seller_discount+=order.discount;
      entry.commission_net+=order.fees.commission;
      entry.service_net+=order.fees.service;
      entry.transaction_fee+=order.fees.transaction;
      daily.set(key,entry);
    }else{
      // Multi-SKU or conflicting order-level fees cannot be assigned to one
      // variation. Keep these values in a visible financial coverage metric.
      month.unallocated_orders++;
      month.unallocated_units+=order.units;
      month.unallocated_revenue+=order.revenue;
    }
    months.set(order.month,month);
  }
  const financialColumns=['product_revenue','seller_discount','commission_net','service_net',
    'transaction_fee','unallocated_revenue'];
  const normalize=row=>{
    const record={...row};
    for(const key of financialColumns)if(key in record)record[key]=amount(record[key]);
    return record;
  };
  // Stable pseudonymous key deduplicates an order across split Shopee files.
  // Raw order IDs, buyer details and delivery data never leave the browser.
  const finance_order_rows=[];
  for(const order of groups.values()){
    const digest=await globalThis.crypto.subtle.digest('SHA-256',
      new TextEncoder().encode('NISTI_SHOPEE_FINANCE_V1|'+order.orderKey));
    const order_hash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    finance_order_rows.push({
      order_hash,month_start:order.month,sale_date:order.date,
      sku_norm:order.skus.size===1?[...order.skus][0]:null,
      sku_count:order.skus.size,source_rows:order.sourceRows,
      units:order.units,product_revenue:amount(order.revenue),
      seller_discount:amount(order.discount),
      fee_valid:Boolean(order.fees&&!order.conflicting),
      transaction_fee:order.fees?amount(order.fees.transaction):null,
      commission_net:order.fees?amount(order.fees.commission):null,
      service_net:order.fees?amount(order.fees.service):null
    });
  }
  return {
    finance_order_rows,
    finance_daily_rows:[...daily.values()].map(normalize).sort((a,b)=>
      a.sale_date.localeCompare(b.sale_date)||a.sku_norm.localeCompare(b.sku_norm)),
    finance_month_rows:[...months.values()].filter(m=>m.fee_orders>0).map(normalize).sort((a,b)=>
      a.month_start.localeCompare(b.month_start)),
    finance_summary:{
      orders:groups.size,fee_orders:[...months.values()].reduce((n,m)=>n+m.fee_orders,0),
      attributable_orders:[...months.values()].reduce((n,m)=>n+m.single_sku_fee_orders,0)
    }
  };
}
