// Dados extras dos pedidos Shopee, resumidos por dia e SKU no navegador.
// Nenhum id de pedido, nome, telefone ou endereço sai daqui: só somas.
const fold=value=>String(value==null?'':value).normalize('NFD').replace(/[̀-ͯ]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const cents=n=>Math.round((Number(n)||0)*100);
const money=c=>Number((c/100).toFixed(2));
const good=n=>Number.isFinite(n)&&n>=0;
const MAX_KEYS=30;

export function shopeeExtrasColumns(headerRow=[]){
  const names=headerRow.map(fold);
  const at=label=>names.indexOf(fold(label));
  const cols={
    price_orig:at('Preço original'),price_paid:at('Preço acordado'),
    ship_est:at('Valor estimado do frete'),ship_paid:at('Taxa de envio pagas pelo comprador'),
    cashback:at('Coin Cashback Voucher Amount Sponsored by Seller'),
    uf:at('UF'),reason:at('Cancelar Motivo')
  };
  return cols.price_orig>=0&&cols.price_paid>=0?cols:null;
}

export function cancelReasonKey(text){
  const t=String(text==null?'':text).trim();
  if(!t)return 'sem motivo';
  const f=fold(t);
  const who=f.includes('pelo comprador')?'comprador':f.includes('sistema')?'sistema':f.includes('vendedor')?'vendedor':'outro';
  const m=t.match(/motivo\s*:\s*(.+)$/i);
  return (who+': '+(m?m[1].trim():'')).slice(0,80);
}

function bump(map,key,by){
  if(!(key in map)&&Object.keys(map).length>=MAX_KEYS)key='outros';
  map[key]=(map[key]||0)+by;
}

// confirmed: {order_id,sale_date,sku_norm,units,extras:{price_orig,price_paid,ship_est,ship_paid,cashback,uf}}
// cancelled: {order_id,sale_date,sku_norm,units,reason}
export function aggregateShopeeExtras(confirmed=[],cancelled=[]){
  const days=new Map();
  const day=(date,sku)=>{
    const key=date+'\x1f'+sku;
    let d=days.get(key);
    if(!d){
      d={sale_date:date,sku_norm:sku,units:0,orig:0,paid:0,min:null,max:null,
        cUnits:0,cOrders:new Set(),reasons:{},shipOrders:0,shipEst:0,shipPaid:0,cash:0,uf:{}};
      days.set(key,d);
    }
    return d;
  };
  const orders=new Map();
  for(const r of confirmed){
    if(!r||!r.sale_date||!r.sku_norm||!r.extras)continue;
    const e=r.extras,u=Math.max(1,Number(r.units)||1),d=day(r.sale_date,r.sku_norm);
    d.units+=u;
    if(good(e.price_orig)&&e.price_orig>0)d.orig+=cents(e.price_orig)*u;
    if(good(e.price_paid)&&e.price_paid>0){
      d.paid+=cents(e.price_paid)*u;
      d.min=d.min==null?e.price_paid:Math.min(d.min,e.price_paid);
      d.max=d.max==null?e.price_paid:Math.max(d.max,e.price_paid);
    }
    const uf=String(e.uf==null?'':e.uf).trim().slice(0,40);
    if(uf)bump(d.uf,uf,u);
    const o=orders.get(r.order_id)||{skus:new Set(),first:r};
    o.skus.add(r.sale_date+'\x1f'+r.sku_norm);
    orders.set(r.order_id,o);
  }
  // Frete e cashback são do pedido inteiro (repetidos em cada linha): só entram
  // quando o pedido tem um único SKU, igual às taxas da Shopee.
  for(const o of orders.values()){
    if(o.skus.size!==1)continue;
    const r=o.first,e=r.extras,d=day(r.sale_date,r.sku_norm);
    d.shipOrders++;
    if(good(e.ship_est))d.shipEst+=cents(e.ship_est);
    if(good(e.ship_paid))d.shipPaid+=cents(e.ship_paid);
    if(good(e.cashback))d.cash+=cents(e.cashback);
  }
  for(const r of cancelled){
    if(!r||!r.sale_date||!r.sku_norm)continue;
    const d=day(r.sale_date,r.sku_norm),u=Math.max(1,Number(r.units)||1);
    d.cUnits+=u;d.cOrders.add(r.order_id);
    bump(d.reasons,cancelReasonKey(r.reason),u);
  }
  const rows=[...days.values()].map(d=>({
    sale_date:d.sale_date,sku_norm:d.sku_norm,units:d.units,
    price_orig_sum:money(d.orig),price_paid_sum:money(d.paid),
    price_paid_min:d.min==null?null:Number(d.min.toFixed(2)),
    price_paid_max:d.max==null?null:Number(d.max.toFixed(2)),
    cancelled_units:d.cUnits,cancelled_orders:d.cOrders.size,cancel_reasons:d.reasons,
    ship_orders:d.shipOrders,ship_est:money(d.shipEst),ship_paid:money(d.shipPaid),
    cashback_seller:money(d.cash),uf_units:d.uf
  })).sort((a,b)=>a.sale_date.localeCompare(b.sale_date)||a.sku_norm.localeCompare(b.sku_norm));
  return {order_extras_daily_rows:rows};
}
