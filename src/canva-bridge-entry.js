import { handleCanvaImageBridgeRequest } from './canva-image-router.js';
import { supabaseRpc } from './supabase-read-store.js';

const RECOVERABLE_STATUS_REASONS = new Set([
  'canva_api_error',
  'canva_api_timeout',
  'canva_api_transport_error'
]);

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'
    }
  });
}

async function hasStoredCanvaConnection(env){
  try{
    const row=await supabaseRpc(env,'nisti_canva_connection_get_v1',{});
    return Boolean(row?.payload_ciphertext && row?.payload_iv);
  }catch{
    return false;
  }
}

export async function handleCanvaBridgeRequest(request,env){
  const response=await handleCanvaImageBridgeRequest(request,env);
  if(!response) return null;

  const url=new URL(request.url);
  if(
    url.pathname!=='/api/admin/canva/status'
    || request.method!=='GET'
    || !response.headers.get('content-type')?.includes('application/json')
  ){
    return response;
  }

  const payload=await response.clone().json().catch(()=>null);
  if(
    !payload
    || payload.connected!==false
    || !RECOVERABLE_STATUS_REASONS.has(String(payload.reason||''))
  ){
    return response;
  }

  const stored=await hasStoredCanvaConnection(env);
  if(!stored) return response;

  return json({
    ...payload,
    connected:true,
    status_degraded:true,
    warning:'A sessão do Canva está salva e ativa; a verificação auxiliar do Canva falhou temporariamente.'
  },response.status);
}
