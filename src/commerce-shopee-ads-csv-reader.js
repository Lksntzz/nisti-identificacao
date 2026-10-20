// Shopee Ads CSV reader: preserves source attribution without altering sales imports.
// An export is one cumulative period. Never split it into daily, 7d or 30d estimates.
const MAX_BYTES=5*1024*1024;
export function parseShopeeCsvGrid(text) {
  const raw=String(text||'').replace(/^\uFEFF/,'');
  if(raw.length>MAX_BYTES)throw Error('O CSV Shopee Ads excede 5 MB.');
  const rows=[];let cell='',line=[],quoted=false;
  for(let i=0;i<raw.length;i++){
    const ch=raw[i];
    if(quoted){
      if(ch==='"'&&raw[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"')quoted=false;
      else cell+=ch;
    }else if(ch==='"'){if(cell!=='')throw Error('Aspas CSV malformadas.');quoted=true;}
    else if(ch===','){line.push(cell);cell='';}
    else if(ch==='\n'){line.push(cell.replace(/\r$/,''));rows.push(line);line=[];cell='';}
    else if(ch!=='\r')cell+=ch;
  }
  if(quoted)throw Error('CSV com campo não encerrado.');
  if(cell||line.length){line.push(cell);rows.push(line);}
  return rows;
}
const pick=(row,columns,key)=>String(row?.[columns[key]]??'').trim();
function integer(value,field) {
  const s=String(value??'').trim();
  if(s===''||s==='-')return null;
  if(!/^\d{1,13}$/.test(s))throw Error(field+' inválido no CSV Shopee Ads.');
  const v=Number(s);
  if(!Number.isSafeInteger(v)||v>1e12)throw Error(field+' fora do limite.');
  return v;
}
function decimal(value,field,isPercent=false) {
  const s=String(value??'').trim();
  if(s===''||s==='-')return null;
  const raw=s.replace(/%$/,'').replace(',','.');
  if(!/^\d{1,13}(?:\.\d{1,4})?$/.test(raw))throw Error(field+' inválido no CSV.');
  const v=Number(raw);
  if(!Number.isFinite(v)||v<0||v>1e12||(isPercent&&v>100))throw Error(field+' fora do limite.');
  return v;
}
function isoDate(pt) {
  const m=/^(\d{2})\/(\d{2})\/(20\d{2})$/.exec(String(pt||''));
  if(!m)throw Error('Período Shopee Ads inválido.');
  const value=m[3]+'-'+m[2]+'-'+m[1];
  if(new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)
    throw Error('Data inválida no período.');
  return value;
}
export function parseShopeeAdsCsv(text, filename='relatorio.csv') {
  const grid=parseShopeeCsvGrid(text);
  if(!String(grid[0]?.[0]||'').includes('Anúncios CPC - Shopee Brasil'))
    throw Error('Arquivo não identificado como relatório Shopee Ads.');
  const headersIndex=grid.findIndex(row=>row.includes('Nome do Anúncio')&&row.includes('ID do produto'));
  if(headersIndex<4)throw Error('Cabeçalho do relatório Shopee Ads não encontrado.');
  const metadata=Object.fromEntries(grid.slice(1,headersIndex)
    .filter(row=>row.length>=2).map(row=>[row[0],row[1]]));
  const period=/^(\d{2}\/\d{2}\/20\d{2})\s*-\s*(\d{2}\/\d{2}\/20\d{2})$/.exec(metadata['Período']||'');
  if(!period)throw Error('O relatório não tem um período reconhecível.');
  const start=isoDate(period[1]),end=isoDate(period[2]);
  const length=(Date.parse(end)-Date.parse(start))/86400000+1;
  if(length<1||length>367)throw Error('Período fora do limite de relatórios.');
  const h=grid[headersIndex],col=Object.fromEntries(h.map((v,i)=>[v.trim(),i]));
  const required=['#','Nome do Anúncio','ID do produto','Impressões','Cliques','CTR',
    'Conversões','Taxa de Conversão','Itens Vendidos','GMV','Despesas','ROAS'];
  if(required.some(k=>col[k]==null))throw Error('CSV Shopee Ads sem colunas obrigatórias.');
  const kind=col['Palavra-chave/Localização']!=null?'TARGETING':'GENERAL';
  const rowSet=grid.slice(headersIndex+1).filter(r=>r.some(x=>String(x).trim()));
  if(!rowSet.length||rowSet.length>1000)throw Error('O CSV deve ter de 1 a 1000 linhas.');
  const rows=rowSet.map((r,index)=>{
    if(r.length!==h.length)throw Error('CSV com número de colunas diferente na linha '+(index+1));
    const number=integer(pick(r,col,'#'),'Linha');
    if(number===null)throw Error('Linha de anúncio sem índice.');
    const productId=pick(r,col,'ID do produto');
    const name=pick(r,col,'Nome do Anúncio');
    if(name.length<1||name.length>300)throw Error('Nome do anúncio inválido.');
    if(productId!=='-'&&!/^\d{5,24}$/.test(productId))throw Error('ID do produto inválido.');
    const target=kind==='TARGETING'?pick(r,col,'Palavra-chave/Localização'):null;
    return {
      name,product_id:productId==='-'?null:productId,
      target:target&&target!=='-'?target.slice(0,160):null,
      impressions:integer(pick(r,col,'Impressões'),'Impressões'),
      clicks:integer(pick(r,col,'Cliques'),'Cliques'),
      conversions:integer(pick(r,col,'Conversões'),'Conversões'),
      items_sold:integer(pick(r,col,'Itens Vendidos'),'Itens vendidos'),
      ctr_pct:decimal(pick(r,col,'CTR'),'CTR',true),
      conversion_pct:decimal(pick(r,col,'Taxa de Conversão'),'Taxa de conversão',true),
      gmv:decimal(pick(r,col,'GMV'),'GMV'),
      spend:decimal(pick(r,col,'Despesas'),'Despesas'),
      roas:decimal(pick(r,col,'ROAS'),'ROAS')
    };
  });
  if(!/^\d{3,24}$/.test(metadata['ID da Loja']||''))throw Error('ID da loja Shopee inválido.');
  return {report:{
    kind,start,end,shop_id:metadata['ID da Loja'],
    shop_name:String(metadata['Nome da loja']||'').slice(0,200),
    exported_at:String(metadata['Data de Criação do Relatório']||'').slice(0,60),
    filename:String(filename).slice(0,220)
  },rows,days:length,hasExplicitKeywords:kind==='TARGETING'&&rows.some(r=>
    r.target&&!['Selecionado Automaticamente','Automático'].includes(r.target))};
}
export async function readShopeeAdsCsvFile(file){
  if(!(file instanceof Blob)||file.size<=0||file.size>MAX_BYTES||
    !/\.csv$/i.test(file.name||''))throw Error('Selecione um relatório Shopee Ads CSV de até 5 MB.');
  const bytes=await file.arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const sha=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
  const parsed=parseShopeeAdsCsv(new TextDecoder('utf-8').decode(bytes),file.name);
  return {...parsed,report:{...parsed.report,sha256:sha}};
}
