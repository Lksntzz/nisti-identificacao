import readExcelFile from 'read-excel-file/browser';

// "Relatório de desempenho das publicações" do Mercado Livre (aba "Relatório"), de UMA conta.
// Lê só métricas por anúncio/variação. Nenhum dado pessoal existe nesse arquivo e nenhum é lido além dos listados.
const MAX_BYTES=12*1024*1024, MAX_ROWS=5000;
const REQUIRED=['ID do anúncio','Anúncio','Visitas únicas','Quantidade de vendas','Unidades vendidas'];
const str=v=>String(v??'').trim();
const fold=v=>str(v).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
function count(v){
  if(v===null||v===undefined||str(v)===''||str(v)==='-')return null;
  if(typeof v==='number'){
    if(!Number.isFinite(v)||v<0)throw Error('Número inválido no relatório.');
    return Math.round(v);
  }
  const clean=str(v).replace(/\./g,'');
  if(!/^\d{1,12}$/.test(clean))throw Error('Número inválido no relatório.');
  return Number(clean);
}
function money(v){
  if(v===null||v===undefined||str(v)===''||str(v)==='-')return null;
  if(typeof v==='number')return v>=0?v:null;
  const n=str(v).replace(/^R\$\s*/i,'').replace(/\./g,'').replace(',','.');
  if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(n))throw Error('Valor inválido no relatório.');
  return Number(n);
}
// Nome esperado: Relatorio_desempenho_publicacoes_AAAA_MM_DD-AAAA_MM_DD.xlsx
export function mlPeriodFromFilename(name){
  const m=/(20\d{2})[_-]?(\d{2})[_-]?(\d{2})\s*[-_]\s*(20\d{2})[_-]?(\d{2})[_-]?(\d{2})/.exec(String(name||''));
  if(!m)throw Error('Não achei o período no nome do arquivo (esperado AAAA_MM_DD-AAAA_MM_DD).');
  const start=m[1]+'-'+m[2]+'-'+m[3],end=m[4]+'-'+m[5]+'-'+m[6];
  for(const d of [start,end])
    if(Number.isNaN(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('Período inválido no nome do arquivo.');
  const days=(Date.parse(end)-Date.parse(start))/86400000+1;
  if(days<1||days>401)throw Error('O período do relatório deve ter de 1 a 401 dias.');
  return {start,end,days};
}
export function parseMlPerformanceSheets(sheets,filename,account){
  if(!['ANTIGO','NOVO'].includes(account))throw Error('Escolha a conta do Mercado Livre (Novo ou Antigo).');
  const period=mlPeriodFromFilename(filename);
  if(!Array.isArray(sheets)||!sheets.length)throw Error('Planilha vazia.');
  const sheet=sheets.find(s=>fold(s?.sheet)==='relatorio')||sheets[0];
  const grid=Array.isArray(sheet?.data)?sheet.data:[];
  const head=grid.findIndex(row=>Array.isArray(row)&&REQUIRED.every(c=>row.map(str).includes(c)));
  if(head<0)throw Error('Não reconheci o relatório de desempenho das publicações do Mercado Livre.');
  const idx=Object.fromEntries(grid[head].map((s,i)=>[str(s),i]));
  const rows=[];
  for(const row of grid.slice(head+1)){
    if(!Array.isArray(row)||!row.some(v=>str(v)))continue;
    const rawId=str(row[idx['ID do anúncio']]).replace(/\D/g,'');
    if(!rawId)continue; // linha de rodape ou vazia
    if(!/^\d{6,14}$/.test(rawId))throw Error('Linha com ID do anúncio inválido.');
    if(rows.length>=MAX_ROWS)throw Error('Arquivo excede 5.000 linhas.');
    const take=name=>idx[name]==null?null:row[idx[name]];
    rows.push({
      listing_id:'MLB'+rawId,title:str(take('Anúncio')).slice(0,300),status:str(take('Status atual')).slice(0,40),
      variation:str(take('Variação')).slice(0,200),sku:str(take('SKU')).slice(0,120),
      quality:str(take('Qualidade do anúncio')).slice(0,40),experience:str(take('Experiência de compra')).slice(0,40),
      visits:count(take('Visitas únicas')),sales:count(take('Quantidade de vendas')),buyers:count(take('Compradores únicos')),
      units:count(take('Unidades vendidas')),gross:money(take('Vendas brutas (BRL)')),
      reviews:count(take('Total de opiniões')),bad:count(take('Opiniões ruins')),good:count(take('Opiniões boas'))
    });
  }
  if(!rows.length)throw Error('Nenhum anúncio encontrado no relatório.');
  const perListing=new Map();
  for(const r of rows)perListing.set(r.listing_id,Math.max(perListing.get(r.listing_id)||0,r.visits||0));
  const sum=key=>rows.reduce((a,r)=>a+(r[key]||0),0);
  return {report:{filename:String(filename).slice(0,220),start:period.start,end:period.end,account},days:period.days,rows,
    totals:{listings:perListing.size,visits:[...perListing.values()].reduce((a,b)=>a+b,0),
      sales:sum('sales'),units:sum('units'),gross:sum('gross')}};
}
export async function readMlPerformanceFile(file,account){
  if(!file||!/\.xlsx$/i.test(file.name||'')||!Number.isFinite(file.size)||file.size<=0||file.size>MAX_BYTES)
    throw Error('Selecione o arquivo .xlsx de desempenho do Mercado Livre (até 12 MB).');
  const buffer=await file.arrayBuffer();
  const sheets=await readExcelFile(buffer);
  const parsed=parseMlPerformanceSheets(sheets,file.name,account);
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  const sha256=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  return {...parsed,report:{...parsed.report,sha256}};
}
