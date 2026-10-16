// Bulk recovery imports ONLY financial aggregates from previously committed
// Shopee workbooks. Every file is checked against its original SHA-256 by the
// authenticated server. Never calls the sales-import commit endpoint.
const MAX_FILES=24;
const MAX_TOTAL_BYTES=220*1024*1024;
const MAX_FILE_BYTES=25*1024*1024;

export function validateFinanceRecoveryFiles(input){
  const files=Array.from(input||[]);
  if(!files.length)throw new Error('Selecione pelo menos uma planilha Shopee.');
  if(files.length>MAX_FILES)throw new Error('Selecione no máximo 24 planilhas de cada vez.');
  const seen=new Set();
  let total=0;
  for(const file of files){
    const name=String(file?.name||'');
    if(!/\.xlsx$/i.test(name))
      throw new Error('Selecione somente arquivos .xlsx. Extraia os ZIPs antes.');
    if(!Number.isFinite(file?.size)||file.size<1||file.size>MAX_FILE_BYTES)
      throw new Error('Cada planilha deve ter no máximo 25 MB.');
    if(seen.has(name.toLowerCase()))
      throw new Error('A seleção contém o mesmo nome de arquivo duas vezes.');
    seen.add(name.toLowerCase());
    total+=file.size;
  }
  if(total>MAX_TOTAL_BYTES)
    throw new Error('A seleção excede 220 MB. Divida em dois lotes.');
  // Month and part order is important for backfill_activate_v1 WAITING_PARTS.
  return files.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{numeric:true}));
}

export async function recoverMultipleShopeeFinances(files,{
  parse,recover,onProgress=()=>{}
}={}){
  if(typeof parse!=='function'||typeof recover!=='function')
    throw new Error('Processador financeiro indisponível.');
  const selected=validateFinanceRecoveryFiles(files);
  const results=[];
  for(let i=0;i<selected.length;i++){
    const file=selected[i];
    onProgress({phase:'finance',fileIndex:i+1,fileCount:selected.length,
      filename:file.name,completed:0,total:1});
    try{
      const parsed=await parse(file,'SHOPEE','');
      if(parsed?.platform_code!=='SHOPEE'||!Array.isArray(parsed.finance_month_rows)||
         parsed.finance_month_rows.length===0)
        throw new Error('O arquivo não contém taxas verificáveis da Shopee.');
      const response=await recover(parsed,detail=>onProgress({
        ...detail,phase:'finance',fileIndex:i+1,fileCount:selected.length,
        filename:file.name
      }));
      const result=response?.result||{};
      if(!['WAITING_PARTS','COMMITTED'].includes(result.status))
        throw new Error('O servidor não confirmou a recuperação financeira.');
      results.push({filename:file.name,status:result.status,
        finance_months:Number(result.finance_months||0),
        parts_received:Number(result.parts_received||0),
        parts_expected:Number(result.parts_expected||0)});
    }catch(error){
      results.push({filename:file.name,status:'ERROR',
        error:String(error?.message||'Falha ao recuperar taxas')});
    }
  }
  // WAITING_PARTS is not an error if the other half arrived later and
  // completed the same export. The final count is based on activations only.
  const groupKey=name=>String(name||'').replace(
    /_part_[0-9]+_of_[0-9]+[.]xlsx$/i,'.xlsx').toLowerCase();
  const completedGroups=new Set(results.filter(x=>x.status==='COMMITTED')
    .map(x=>groupKey(x.filename)));
  return {
    total:results.length,
    successful:results.filter(x=>x.status==='COMMITTED').length,
    recoveredMonths:results.reduce((n,x)=>n+Number(x.finance_months||0),0),
    failures:results.filter(x=>x.status==='ERROR'),
    awaitingParts:results.filter(x=>x.status==='WAITING_PARTS'&&
      !completedGroups.has(groupKey(x.filename))),
    results
  };
}
