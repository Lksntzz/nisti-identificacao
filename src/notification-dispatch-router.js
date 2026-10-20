import { supabaseRpc } from './supabase-read-store.js';
import { normalizePlatform } from './platform-scope.js';

export const DISPATCH_DURATION_SECONDS=15;
export const DISPATCH_PLATFORMS=Object.freeze(['SHOPEE','MERCADO LIVRE','AMAZON']);
export const DISPATCH_ACTION='RETIRAR_CAPA';
const MONITOR_COOKIE='__Host-nisti_dispatch_monitor';
const MONITOR_COOKIE_AGE=60*60*24*180;

function json(value,status=200,headers={}) {
  return new Response(JSON.stringify(value),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store, private',...headers
  }});
}
function monitorKey(request) {
  const cookies=String(request.headers.get('cookie')||'').split(';');
  const part=cookies.find(x=>x.trim().startsWith(MONITOR_COOKIE+'='));
  const key=part?.trim().slice(MONITOR_COOKIE.length+1)||'';
  return /^[0-9a-f]{64}$/.test(key)?key:null;
}
async function digest(value) {
  const bytes=new TextEncoder().encode(value);
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}
function newMonitorKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),
    x=>x.toString(16).padStart(2,'0')).join('');
}
function validRequestKey(value) {
  return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function errorResponse(error) {
  const message=String(error?.message||'');
  if(message.includes('dispatch_queue_full'))return json({error:'A fila atingiu 50 notificações pendentes.'},409);
  if(message.includes('dispatch_idempotency_conflict'))return json({error:'A solicitação foi alterada após o envio. Atualize antes de reenviar.'},409);
  if(message.includes('invalid_dispatch_batch'))return json({error:'Seleção ou mensagens inválidas.'},400);
  if(message.includes('monitor_unauthorized'))return json({error:'Monitor desconectado. Ative novamente.'},401);
  console.error('[NISTI Dispatch] Falha',error?.code||error?.name||'backend_error');
  return json({error:'Não foi possível acessar o serviço de notificações.'},503);
}
export async function handleNotificationDispatchRequest(request,env) {
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/dispatch/') && !path.startsWith('/api/admin/dispatch'))return null;
  try {
    if(path==='/api/admin/dispatch'&&request.method==='GET') {
      return json({ok:true,...(await supabaseRpc(env,'nisti_dispatch_status_v1',{}))});
    }
    if(path==='/api/admin/dispatch'&&request.method==='POST') {
      const body=await request.json().catch(()=>null);
      const platform=normalizePlatform(body?.platform);
      if(!DISPATCH_PLATFORMS.includes(platform)||body?.action!==DISPATCH_ACTION
        ||!validRequestKey(body?.request_key))return json({error:'Plataforma, ação ou chave inválida.'},400);
      const item=await supabaseRpc(env,'nisti_dispatch_enqueue_v1',{
        p_platform:platform,p_action:DISPATCH_ACTION,p_request_key:body.request_key
      });
      return json({ok:true,call:item},201);
    }
    if(path==='/api/admin/dispatch/batch'&&request.method==='POST') {
      const body=await request.json().catch(()=>null);
      const calls=body?.calls;
      if(!Array.isArray(calls)||calls.length<1||calls.length>3)return json({error:'Selecione de uma a três plataformas.'},400);
      const seen=new Set();
      const validated=[];
      for(const call of calls) {
        const platform=normalizePlatform(call?.platform);
        const message=typeof call?.message==='string'?call.message.trim():'';
        if(!DISPATCH_PLATFORMS.includes(platform)||seen.has(platform)||!validRequestKey(call?.request_key)
          ||message.length<1||message.length>120||/[\x00-\x1f\x7f]/.test(message))
          return json({error:'Revise as plataformas e as mensagens (até 120 caracteres, sem quebras de linha).'},400);
        seen.add(platform);
        validated.push({platform,message,request_key:call.request_key});
      }
      const result=await supabaseRpc(env,'nisti_dispatch_enqueue_batch_v2',{p_calls:validated});
      return json({ok:true,...result},201);
    }
    if(path==='/api/admin/dispatch/monitor-key'&&request.method==='POST') {
      const key=newMonitorKey();
      await supabaseRpc(env,'nisti_dispatch_pair_monitor_v1',{p_digest:await digest(key)});
      return json({ok:true,key,monitor_url:'/monitor-notificacoes'},201);
    }
    if(path==='/api/dispatch/activate'&&request.method==='POST') {
      const body=await request.json().catch(()=>null);
      const key=String(body?.key||'').trim().toLowerCase();
      if(!/^[0-9a-f]{64}$/.test(key))return json({error:'Chave de monitor inválida.'},401);
      const valid=await supabaseRpc(env,'nisti_dispatch_monitor_valid_v1',{p_digest:await digest(key)});
      if(valid!==true)return json({error:'Chave não autorizada ou substituída.'},401);
      return json({ok:true},200,{'set-cookie':MONITOR_COOKIE+'='+key+
        '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+MONITOR_COOKIE_AGE});
    }
    if(path==='/api/dispatch/next'&&request.method==='POST') {
      const key=monitorKey(request);
      if(!key)return json({error:'Ative o monitor com a chave da administração.'},401);
      const data=await supabaseRpc(env,'nisti_dispatch_next_v1',{p_digest:await digest(key)});
      return json({ok:true,...data});
    }
    return json({error:'Rota ou método não permitido.'},405,{'allow':'GET, POST'});
  }catch(error){return errorResponse(error)}
}