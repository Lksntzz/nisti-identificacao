import readExcelFile from 'read-excel-file/browser';

// Relatorio "parentskudetail" da Central do Vendedor Shopee (aba "Produtos com Melhor Desempenho").
// Usa so as linhas por ANUNCIO (ID da Variacao = "-"). Nenhum dado pessoal e lido.
const MAX_BYTES=12*1024*1024, MAX_ROWS=3000;
const SHEET_HINT='Produtos com Melhor Desempenho';
const REQUIRED=['ID do Item','ID da Variação','Impressão do Produto','Cliques Por Produto'];
const str=v=>String(v??'').trim();
const COLUMNS={
  impressions:'Impressão do Produto',clicks:'Cliques Por Produto',visitors:'Visitantes do Produto (Visita)',
  page_views:'Visualizações da Página do Produto',add_cart_visitors:'Visitantes do Produto (Adicionar ao Carrinho)',
  orders:'Pedido Feito',units:'Unidades (Pedido realizado)',buyers:'Compradores (Pedido realizado)'
};
function count(v){
  const s=str(v);
  if(!s||s==='-')return null;
  if(typeof v==='number'){
    if(!Number.isSafeInteger(v)||v<0)throw Error('Número inválido no relatório.');
    return v;
  }
  const clean=s.replace(/\./g,'');
  if(!/^\d{1,12}$/.test(clean))throw Error('Número inválido no relatório.');
  return Number(clean);
}
function money(v){
  const s=str(v);
  if(!s||s==='-')return null;
  if(typeof v==='number')return v>=0?v:null;
  const n=s.replace(/^R\$\s*/i,'').replace(/\./g,'').replace(',','.');
  if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(n))throw Error('Valor inválido no relatório.');
  return Number(n);
}
export function periodFromFilename(name){
  const m=/(20\d{2})(\d{2})(\d{2})[_-](20\d{2})(\d{2})(\d{2})/.exec(String(name||''));
  if(!m)throw Error('Não achei o período no nome do arquivo (esperado AAAAMMDD_AAAAMMDD).');
  const start=m[1]+'-'+m[2]+'-'+m[3],end=m[4]+'-'+m[5]+'-'+m[6];
  for(const d of [start,end])
    if(Number.isNaN(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('Período inválido no nome do arquivo.');
  const days=(Date.parse(end)-Date.parse(start))/86400000+1;
  if(days<1||days>93)throw Error('O período do relatório deve ter de 1 a 93 dias.');
  return {start,end,days};
}
export function parseShopeePerformanceSheets(sheets,filename){
  const period=periodFromFilename(filename);
  if(!Array.isArray(sheets)||!sheets.length)throw Error('Planilha vazia.');
  const sheet=sheets.find(s=>String(s?.sheet||'').includes(SHEET_HINT))||sheets[0];
  const grid=Array.isArray(sheet?.data)?sheet.data:[];
  const head=grid.findIndex(row=>Array.isArray(row)&&REQUIRED.every(c=>row.map(str).includes(c)));
  if(head<0)throw Error('Não reconheci o relatório de desempenho por produto da Shopee (aba "Produtos com Melhor Desempenho").');
  const idx=Object.fromEntries(grid[head].map((s,i)=>[str(s),i]));
  const rows=[],seen=new Set();
  for(const row of grid.slice(head+1)){
    if(!Array.isArray(row)||!row.some(v=>str(v)))continue;
    if(str(row[idx['ID da Variação']])!=='-')continue; // linhas de variacao nao entram
    const itemId=str(row[idx['ID do Item']]);
    if(!/^\d{5,20}$/.test(itemId))throw Error('Linha com ID do item inválido.');
    if(seen.has(itemId))continue;
    seen.add(itemId);
    if(rows.length>=MAX_ROWS)throw Error('Arquivo excede 3.000 anúncios.');
    const take=name=>idx[name]==null?null:row[idx[name]];
    rows.push({item_id:itemId,name:str(take('Produto')).slice(0,300),
      impressions:count(take(COLUMNS.impressions)),clicks:count(take(COLUMNS.clicks)),
      visitors:count(take(COLUMNS.visitors)),page_views:count(take(COLUMNS.page_views)),
      add_cart_visitors:count(take(COLUMNS.add_cart_visitors)),orders:count(take(COLUMNS.orders)),
      units:count(take(COLUMNS.units)),buyers:count(take(COLUMNS.buyers)),
      revenue:money(take('Vendas (Pedido realizado) (BRL)')),revenue_paid:money(take('Vendas (Pedido pago) (BRL)'))});
  }
  if(!rows.length)throw Error('Nenhum anúncio encontrado no relatório.');
  const total=key=>rows.reduce((a,r)=>a+(r[key]||0),0);
  return {report:{filename:String(filename).slice(0,220),start:period.start,end:period.end},days:period.days,rows,
    totals:{impressions:total('impressions'),clicks:total('clicks'),orders:total('orders'),units:total('units'),revenue:total('revenue')}};
}
export async function readShopeePerformanceFile(file){
  if(!file||!/\.xlsx$/i.test(file.name||'')||!Number.isFinite(file.size)||file.size<=0||file.size>MAX_BYTES)
    throw Error('Selecione o arquivo .xlsx de desempenho da Shopee (até 12 MB).');
  const buffer=await file.arrayBuffer();
  const sheets=await readExcelFile(buffer);
  const parsed=parseShopeePerformanceSheets(sheets,file.name);
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  const sha256=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  return {...parsed,report:{...parsed.report,sha256}};
}
