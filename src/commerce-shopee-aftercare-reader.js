import readExcelFile from 'read-excel-file/browser';

// Official Shopee Returns/Refunds export. Never collect purchaser identity,
// phone numbers, addresses, ZIP, observations, IMEI or tracking numbers.
const MAX_BYTES=8*1024*1024, MAX_ROWS=5000;
const REQUIRED=['ID da Devolução','ID do pedido','SKU principal',
  'Status da Devolução / Reembolso','Quantidade de Devoluções',
  'Quantia total de reembolsos'];
const str=v=>String(v??'').trim();
const short=(v,n)=>str(v).slice(0,n);
function dateValue(v){
  if(v instanceof Date&&!Number.isNaN(v.valueOf()))return v.toISOString();
  const s=str(v);
  if(!s)return null;
  const match=/^(20\d\d)-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?$/.exec(s);
  if(!match)throw new Error('Data inválida no arquivo Shopee.');
  const iso=match[1]+'-'+match[2]+'-'+match[3]+'T'+(match[4]||'00')+
    ':'+(match[5]||'00')+':'+(match[6]||'00')+'Z';
  if(Number.isNaN(Date.parse(iso))||new Date(iso).toISOString().slice(0,19)!==iso.slice(0,19))
    throw new Error('Data inválida no arquivo Shopee.');
  return iso;
}
function amount(v){
  const s=str(v).replace(/^R\$\s*/i,'').replace(/\s/g,'');
  if(!s)return null;
  const decimal=s.includes(',')?s.replace(/\./g,'').replace(',','.'):s;
  if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(decimal))throw new Error('Valor de reembolso inválido.');
  return Number(decimal);
}
const normalizedCode=s=>str(s).toUpperCase();
export function parseShopeeAftercareSheets(sheets,filename='retornos.xls'){
  if(!Array.isArray(sheets)||!sheets.length)throw Error('Planilha Shopee vazia.');
  const groups=new Map();let rowCount=0;
  for(const sheet of sheets){
    const grid=Array.isArray(sheet?.data)?sheet.data:[];
    if(!grid.length)continue;
    const head=grid.findIndex(row=>Array.isArray(row)&&REQUIRED.every(c=>row.includes(c)));
    if(head<0)continue;
    const indices=Object.fromEntries(grid[head].map((s,i)=>[str(s),i]));
    const take=(row,col)=>row[indices[col]];
    for(const row of grid.slice(head+1)){
      if(!Array.isArray(row)||!row.some(v=>str(v)))continue;
      rowCount++;
      if(rowCount>MAX_ROWS)throw Error('Arquivo excede 5.000 linhas de pós-venda.');
      const returnId=str(take(row,'ID da Devolução')),orderId=str(take(row,'ID do pedido'));
      if(!/^[a-z0-9_-]{8,48}$/i.test(returnId)||!/^[a-z0-9_-]{5,48}$/i.test(orderId))
        throw Error('Linha com ID da devolução ou do pedido inválido.');
      const sku=normalizedCode(take(row,'SKU da Variação'))||
        normalizedCode(take(row,'SKU principal'));
      if(!sku||sku.length>160)throw Error('Linha da devolução sem SKU válido.');
      const qty=Number(take(row,'Quantidade de Devoluções'));
      if(!Number.isSafeInteger(qty)||qty<1||qty>9999)
        throw Error('Quantidade de devolução inválida.');
      const money=amount(take(row,'Quantia total de reembolsos'));
      const requestedAt=dateValue(take(row,'Tempo de envio de devolução'));
      const orderCreated=dateValue(take(row,'Data de criação do pedido'));
      const status=short(take(row,'Status da Devolução / Reembolso'),120)||'Não informado';
      const current=groups.get(returnId);
      const request={
        return_id:returnId,order_id:orderId,
        requested_at:requestedAt,order_created_at:orderCreated,
        status,solution:short(take(row,'Solução para Retorno e Reembolso'),120)||null,
        reason:short(take(row,'Motivo da Devolução'),250)||null,
        tracking_status:short(take(row,'Status de rastreamento de devolução'),100)||null,
        refund_requested:money,items:[]
      };
      if(current){
        if(current.order_id!==request.order_id||current.status!==request.status||
           current.refund_requested!==request.refund_requested)
          throw Error('Dados conflitantes para a mesma solicitação de devolução.');
        // The refund amount is per request and must never be summed by item.
        current.items.push({sku,quantity:qty});
        if(!current.tracking_status)current.tracking_status=request.tracking_status;
      }else{
        request.items.push({sku,quantity:qty});
        groups.set(returnId,request);
      }
    }
  }
  if(!groups.size)throw Error('Nenhuma aba reconhecida como relatório de devoluções/reembolsos Shopee.');
  const requests=[...groups.values()];
  const dates=requests.map(x=>x.requested_at?.slice(0,10)).filter(Boolean).sort();
  if(!dates.length)throw Error('O arquivo não contém datas verificáveis.');
  const statuses={approved:0,withdrawn:0,other:0,returnsDelivered:0};
  for(const row of requests){
    if(row.status==='Aprovada')statuses.approved++;
    else if(row.status==='Solicitação cancelada pelo comprador')statuses.withdrawn++;
    else statuses.other++;
    if(row.tracking_status==='Devolução concluída')statuses.returnsDelivered++;
  }
  return {report:{filename:short(filename,220),start:dates[0],end:dates[dates.length-1]},
    requests,rowCount,statuses,
    privacy:'Dados pessoais, endereços e observações livres não são enviados.'};
}
export async function readShopeeAftercareFile(file){
  if(!file||!/\.xlsx?$|\.xls$/i.test(file.name||'')||
    !Number.isFinite(file.size)||file.size<=0||file.size>MAX_BYTES)
      throw Error('Selecione XLS/XLSX da Shopee de até 8 MB.');
  const buffer=await file.arrayBuffer();
  const sheets=await readExcelFile(buffer);
  const result=parseShopeeAftercareSheets(sheets,file.name);
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  const sha256=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  return {...result,report:{...result.report,sha256}};
}
