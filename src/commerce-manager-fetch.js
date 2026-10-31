// Retry only transient failures for the read-only commercial manager.
// No browser storage and no retries for invalid filters/authentication failures.
const TRANSIENT_HTTP_STATUSES = new Set([408,429,500,502,503,504]);

// "Atualizar dados": nos próximos 15 s as leituras ignoram o cache curto do servidor.
let freshUntil=0;
export function requestFreshData(){freshUntil=Date.now()+15000;}
function withFresh(url){
  if(Date.now()>=freshUntil||!String(url).startsWith('/api/admin/commerce/'))return url;
  return url+(String(url).includes('?')?'&':'?')+'fresh=1';
}

export async function fetchCommercialManager(url,{signal,fetchImpl=fetch}={}){
  url=withFresh(url);
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetchImpl(url,{credentials:'same-origin',cache:'no-store',signal});
      const payload=await response.json().catch(()=>({}));
      if(response.ok)return payload;
      const error=new Error(payload?.error||'Não foi possível consultar os anúncios.');
      error.retryable=payload?.retryable===true&&TRANSIENT_HTTP_STATUSES.has(response.status);
      throw error;
    }catch(error){
      if(signal?.aborted || attempt===1 || !(error?.retryable===true||error instanceof TypeError))
        throw error;
      // The Worker may be cold or Supabase may be briefly overloaded.
      await new Promise(resolve=>setTimeout(resolve,250));
      if(signal?.aborted)throw new Error('Consulta cancelada.');
    }
  }
  throw new Error('Não foi possível consultar os anúncios.');
}
