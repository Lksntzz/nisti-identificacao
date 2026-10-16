// Native "Vendas BR" Mercado Livre sales export. Header: row 7; package summary lines must not double-count revenue.
// Deliberately excludes buyer PII, shipping addresses and other sensitive columns.
const MONTHS=Object.freeze({
  janeiro:1,fevereiro:2,marco:3,março:3,abril:4,maio:5,junho:6,julho:7,
  agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12
});
const fold=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const str=x=>String(x??'').trim();
const skuNorm=x=>str(x).toUpperCase().replace(/[^A-Z0-9]+/g,'');
const decimal=x=>{
  if(typeof x==='number')return Number.isFinite(x)?x:NaN;
  let v=str(x);
  if(!v)return NaN;
  if(/^-?\d{1,3}(\.\d{3})*,\d+$/.test(v))v=v.replace(/\./g,'').replace(',','.');
  else if(/^-?\d+,\d+$/.test(v))v=v.replace(',','.');
  const n=Number(v);
  return Number.isFinite(n)?n:NaN;
};
const cents=x=>{
  const n=decimal(x);
  return Number.isFinite(n)?Math.round(n*100):null;
};
const money=c=>(c/100).toFixed(2)*1;

export function parseMercadoLivreSaleDate(value) {
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
  const valueString=str(value),latin=fold(valueString);
  const match=latin.match(/\b(\d{1,2}) de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de (\d{4})\b/);
  if(match) {
    const y=Number(match[3]),mo=MONTHS[match[2]],d=Number(match[1]);
    const test=new Date(Date.UTC(y,mo-1,d));
    return test.getUTCFullYear()===y&&test.getUTCMonth()===mo-1&&test.getUTCDate()===d
      ?[y,String(mo).padStart(2,'0'),String(d).padStart(2,'0')].join('-'):null;
  }
  const iso=valueString.match(/^(\d{4})-(\d\d)-(\d\d)/);
  return iso?iso[0]:null;
}
export function detectMercadoLivreVendasBrHeader(sheetRows) {
  const rows=Array.isArray(sheetRows)?sheetRows:[];
  for(let i=0;i<Math.min(rows.length,25);i++){
    const row=rows[i];if(!Array.isArray(row))continue;
    const keys=row.map(fold);
    const indexOf=(...terms)=>keys.findIndex(k=>terms.some(term=>k===term));
    const columns={
      order:indexOf('n de venda','no de venda','numero de venda'),
      date:indexOf('data de venda'),
      status:indexOf('estado'),
      units:indexOf('unidades'),
      revenue:indexOf('receita por produtos brl'),
      sku:indexOf('sku'),
      listing:indexOf('de anuncio','n de anuncio','numero de anuncio'),
      title:indexOf('titulo do anuncio'),
      variation:indexOf('variacao'),
      unitPrice:indexOf('preco unitario de venda do anuncio brl')
    };
    if(['order','date','status','units','revenue','sku','listing','unitPrice'].every(k=>columns[k]>=0))
      return {rowIndex:i,columns};
  }
  return null;
}
const isCancelled=status=>/cancel|reembols|devolu|devolvid|troca|recusad|nao entregue/.test(fold(status));
const isPackage=status=>fold(status).match(/^pacote de (\d+) produtos$/);
const isSummary=status=>Boolean(isPackage(status)||fold(status)==='venda com solicitacao de alteracao');

export function parseMercadoLivreVendasBr(workbook,platformCode,filename,sha256,sizeBytes) {
  if(!['ML_NOVO','ML_ANTIGO'].includes(platformCode))throw Error('Plataforma Mercado Livre inválida.');
  const sheets=Array.isArray(workbook)?workbook:[];
  const sheet=sheets.map(item=>({...item,header:detectMercadoLivreVendasBrHeader(item.data)})).find(item=>item.header);
  if(!sheet)throw Error('Relatório Mercado Livre Vendas BR não identificado.');
  const data=sheet.data,columns=sheet.header.columns;
  const get=(row,key)=>row?.[columns[key]];
  const warning=data.slice(0,sheet.header.rowIndex).some(row=>Array.isArray(row)
    &&row.some(value=>fold(value).includes('nao foi possivel exibir alguns dados')));
  const packChildren=new Map();
  const errors=[],totals={physical_rows:data.length,package_summaries:0,package_items_recovered:0,cancelled_or_returned:0,missing_values:0,duplicate_items:0};
  for(let i=sheet.header.rowIndex+1;i<data.length;i++){
    const row=data[i],status=str(get(row,'status')),match=isPackage(status);
    if(!match)continue;
    totals.package_summaries++;
    const count=Number(match[1]),child=data.slice(i+1,i+1+count),parentCents=cents(get(row,'revenue'));
    const valid=child.length===count
      &&child.every(c=>str(get(c,'sku'))&&str(get(c,'listing'))
        &&Number.isSafeInteger(decimal(get(c,'units')))
        &&decimal(get(c,'units'))>0&&cents(get(c,'unitPrice'))!==null)
      &&parentCents!==null
      &&child.reduce((sum,c)=>sum+cents(get(c,'unitPrice'))*decimal(get(c,'units')),0)===parentCents;
    if(!valid){
      errors.push('Pacote na linha '+(i+1)+' sem conferência de valores e itens.');
      continue;
    }
    const key='PACKAGE:'+str(get(row,'order'));
    child.forEach((c,idx)=>packChildren.set(i+1+idx,{
      order:key,revenueCents:cents(get(c,'unitPrice'))*decimal(get(c,'units'))
    }));
  }
  if(errors.length)throw Error('Importação bloqueada: '+errors.slice(0,3).join(' '));
  const entries=[],seen=new Set();let ignored=0;
  for(let i=sheet.header.rowIndex+1;i<data.length;i++){
    const row=data[i];
    if(!Array.isArray(row)||!row.some(v=>str(v)))continue;
    const status=str(get(row,'status'));
    if(isSummary(status)){ignored++;continue;}
    if(isCancelled(status)){totals.cancelled_or_returned++;ignored++;continue;}
    const sku=str(get(row,'sku')),listing=str(get(row,'listing'));
    if(!sku||!listing){ignored++;continue;}
    const day=parseMercadoLivreSaleDate(get(row,'date'));
    if(!day)throw Error('Data de venda inválida na linha '+(i+1)+'.');
    const q=decimal(get(row,'units'));
    if(!Number.isSafeInteger(q)||q<1)throw Error('Quantidade inválida na linha '+(i+1)+'.');
    const origin=cents(get(row,'revenue'));
    const pack=packChildren.get(i);
    const recovered=origin===null&&pack!=null;
    if(origin===null&&!pack){
      totals.missing_values++;
      throw Error('Receita do produto ausente e sem pacote verificável na linha '+(i+1)+'.');
    }
    if(recovered)totals.package_items_recovered++;
    const income=origin===null?pack.revenueCents:origin;
    const order=pack?.order||str(get(row,'order'));
    if(!order)throw Error('Número da venda ausente na linha '+(i+1)+'.');
    const dedupe=[order,listing,sku,day].join('|');
    if(seen.has(dedupe)){totals.duplicate_items++;ignored++;continue;}
    seen.add(dedupe);
    entries.push({
      day,order,sku,sku_norm:skuNorm(sku),listing,
      product_name:str(get(row,'title'))||null,
      variation:str(get(row,'variation'))||null,
      units:q,revenueCents:income
    });
  }
  if(!entries.length)throw Error('Nenhuma venda válida foi encontrada no Excel do Mercado Livre.');
  const groups=new Map(),daily=new Map(),rawDayCount=new Set();
  for(const e of entries){
    const key=e.day+'|'+e.sku_norm;
    if(!groups.has(key))groups.set(key,{
      day:e.day,sku:e.sku,sku_norm:e.sku_norm,
      product_name:e.product_name,variation:e.variation,
      units:0,revenueCents:0,orders:new Set(),listings:new Set()
    });
    const g=groups.get(key);
    g.units+=e.units;g.revenueCents+=e.revenueCents;g.orders.add(e.order);g.listings.add(e.listing);
    if(!daily.has(e.day))daily.set(e.day,{orders:new Set(),units:0,revenueCents:0,listings:new Set(),skus:new Set()});
    const d=daily.get(e.day);
    d.orders.add(e.order);d.units+=e.units;d.revenueCents+=e.revenueCents;
    d.listings.add(e.listing);d.skus.add(e.sku_norm);rawDayCount.add(e.day);
  }
  const rows=[...groups.values()].sort((a,b)=>a.day.localeCompare(b.day)||a.sku_norm.localeCompare(b.sku_norm))
    .map((g,i)=>({
      source_row_number:i+1,period_key:g.day,period_start:g.day,period_end:g.day,
      sku_primary:g.sku,sku:g.sku,sku_norm:g.sku_norm,
      product_name:g.product_name,variation:g.variation,
      units:g.units,orders_with_item:g.orders.size,product_revenue:money(g.revenueCents)
    }));
  const summaries=[...daily].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,d])=>({
    period_key:date,period_start:date,period_end:date,
    net_orders:d.orders.size,units:d.units,product_revenue:money(d.revenueCents),
    listings_with_sales:d.listings.size,skus_with_sales:d.skus.size
  }));
  const summary={
    physical_rows:data.length,
    accepted_sales_rows:entries.length,
    aggregated_rows:rows.length,
    period_count:summaries.length,
    units:entries.reduce((a,r)=>a+r.units,0),
    net_orders:new Set(entries.map(e=>e.order)).size,
    product_revenue:money(entries.reduce((a,r)=>a+r.revenueCents,0)),
    ignored_rows:ignored,
    ...totals,
    source_warning:warning
  };
  return {
    filename,sha256,size_bytes:sizeBytes,platform_code:platformCode,
    rows,summaries,
    data_through:summaries[summaries.length-1].period_end,
    sheets:[{name:str(sheet.sheet)||'Vendas BR',physical_rows:data.length,
      accepted_rows:entries.length,ignored_rows:ignored}],
    summary
  };
}
