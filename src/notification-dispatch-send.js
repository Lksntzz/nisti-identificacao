import { dispatchOptionValid } from './notification-dispatch-options.js';

// Fonte de verdade: o banco do servidor, nao a lista guardada na aba.
// A chave de idempotencia so e descartada quando o envio foi confirmado
// ou a selecao foi invalidada; falhas de transporte podem ser repetidas sem
// criar chamadas duplicadas.
export async function submitDispatchNotifications({
  platforms, optionFor, fetchOptions, enqueue, pendingBatch,
  newRequestKey=()=>crypto.randomUUID()
}) {
  const latest=await fetchOptions();
  const options=latest?.options;
  if(!options||typeof options!=='object'||Array.isArray(options)){
    throw new Error('Não foi possível conferir as modalidades no servidor. Tente novamente.');
  }
  const unavailable=platforms.filter(platform=>!dispatchOptionValid(platform,optionFor(platform),options));
  if(unavailable.length){
    pendingBatch.current=null;
    return {state:'options_changed',options,unavailable};
  }
  const existing=pendingBatch.current;
  const sameSelection=Array.isArray(existing)&&existing.length===platforms.length
    &&existing.every((call,i)=>call.platform===platforms[i]&&call.option===optionFor(platforms[i]));
  const calls=sameSelection?existing:platforms.map(platform=>({
    platform,option:optionFor(platform),request_key:newRequestKey()
  }));
  pendingBatch.current=calls;
  const data=await enqueue(calls);
  pendingBatch.current=null;
  return {state:'sent',options,data};
}
