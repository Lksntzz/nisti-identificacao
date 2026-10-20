import { supabaseRpc } from './supabase-read-store.js';
import { normalizePlatform } from './platform-scope.js';
import { DISPATCH_PLATFORMS,dispatchOptionValid } from './notification-dispatch-options.js';

export const DISPATCH_DURATION_SECONDS=15;
export { DISPATCH_PLATFORMS } from './notification-dispatch-options.js';
export const DISPATCH_ACTION='RETIRAR_CAPA';
const MONITOR_COOKIE='__Host-nisti_dispatch_monitor';
const MONITOR_COOKIE_AGE=60*60*24*180;
const MONITOR_PAIR_COOKIE='__Host-nisti_dispatch_pair';
const MONITOR_PAIR_AGE=60*10;
const PAIR_COOKIE_FLAGS='; Path=/; HttpOnly; Secure; SameSite=Strict';

function json(value,status=200,headers={}) {
  return new Response(JSON.stringify(value),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store, private',...headers
  }});
}
function readMonitorCookie(request,name) {
  const cookies=String(request.headers.get('cookie')||'').split(';');
  const part=cookies.find(x=>x.trim().startsWith(name+'='));
  const key=part?.trim().slice(name.length+1)||'';
  return /^[0-9a-f]{64}$/.test(key)?key:null;
}
function monitorKey(request) {return readMonitorCookie(request,MONITOR_COOKIE)}
function pairKey(request) {return readMonitorCookie(request,MONITOR_PAIR_COOKIE)}
function monitorCookie(key){return MONITOR_COOKIE+'='+key+PAIR_COOKIE_FLAGS+'; Max-Age='+MONITOR_COOKIE_AGE}
function pairCookie(key){return MONITOR_PAIR_COOKIE+'='+key+PAIR_COOKIE_FLAGS+'; Max-Age='+MONITOR_PAIR_AGE}
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
  if(message.includes('dispatch_option_not_allowed')||message.includes('dispatch_options_invalid'))
    return json({error:'Modalidade inválida. Atualize a lista da plataforma.'},400);
  if(message.includes('monitor_unauthorized'))return json({error:'Monitor desconectado. Solicite autorização no painel de notificações.'},401);
  if(message.includes('monitor_pairing_busy'))return json({error:'Muitas solicitações aguardando. Tente novamente em alguns minutos.'},429);
  if(message.includes('monitor_pairing_expired'))return json({error:'Solicitação expirada. Aguarde uma nova autorização.'},409);
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
    if(path==='/api/admin/dispatch/options'&&request.method==='GET') {
      return json({ok:true,options:await supabaseRpc(env,'nisti_dispatch_options_v4',{})});
    }
    if(path==='/api/admin/dispatch/options'&&request.method==='POST') {
      const body=await request.json().catch(()=>null);
      const platform=body?.platform;
      const options=body?.options;
      if(!DISPATCH_PLATFORMS.includes(platform)||!Array.isArray(options)||options.length>16
         ||options.some(x=>typeof x!=='string'||x.trim()!==x||x.length<1||x.length>60
             ||/[\x00-\x1f\x7f]/.test(x)||x.toUpperCase()==='RETIRAR CAPA')
         ||new Set(options.map(x=>x.toLowerCase())).size!==options.length) {
        return json({error:'Revise as modalidades: até 16 por plataforma e 60 caracteres por opção.'},400);
      }
      const saved=await supabaseRpc(env,'nisti_dispatch_save_options_v4',{
        p_platform:platform,p_options:options
      });
      return json({ok:true,...saved});
    }
    if(path==='/api/admin/dispatch/batch'&&request.method==='POST') {
      const body=await request.json().catch(()=>null);
      const calls=body?.calls;
      if(!Array.isArray(calls)||calls.length<1||calls.length>DISPATCH_PLATFORMS.length)return json({error:'Selecione de uma a dez plataformas.'},400);
      // Formato e duplicações são verificados antes de consultar Supabase.
      // As opções permitidas são checadas depois contra a configuração atual.
      const beforeDb=new Set();
      for(const call of calls){
        const platform=typeof call?.platform==='string'?call.platform.trim().toUpperCase():'';
        const option=typeof call?.option==='string'?call.option.trim():'';
        if(!DISPATCH_PLATFORMS.includes(platform)||beforeDb.has(platform)
          ||!validRequestKey(call?.request_key)||option.length<1||option.length>60
          ||/[\x00-\x1f\x7f]/.test(option)){
          return json({error:'Escolha uma modalidade válida para cada plataforma.'},400);
        }
        beforeDb.add(platform);
      }
      const config=await supabaseRpc(env,'nisti_dispatch_options_v4',{});
      const seen=new Set();
      const validated=[];
      for(const call of calls){
        const platform=typeof call?.platform==='string'?call.platform.trim().toUpperCase():'';
        const option=typeof call?.option==='string'?call.option.trim():'';
        if(!DISPATCH_PLATFORMS.includes(platform)||seen.has(platform)
          ||!validRequestKey(call?.request_key)||!dispatchOptionValid(platform,option,config)){
          return json({error:'Selecione uma modalidade válida para cada plataforma.'},400);
        }
        seen.add(platform);
        validated.push({platform,option,request_key:call.request_key});
      }
      const result=await supabaseRpc(env,'nisti_dispatch_enqueue_batch_v4',{p_calls:validated});
      return json({ok:true,...result},201);
    }
    if(path==='/api/admin/dispatch/pair/pending'&&request.method==='GET') {
      const requests=await supabaseRpc(env,'nisti_dispatch_pair_pending_v5',{});
      return json({ok:true,requests:Array.isArray(requests)?requests:[]});
    }
    if(path==='/api/admin/dispatch/pair/approve'&&request.method==='POST') {
      const body=await request.json().catch(()=>null);
      const id=String(body?.id||'');
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
        return json({error:'Solicitação inválida.'},400);
      await supabaseRpc(env,'nisti_dispatch_approve_pair_v5',{p_id:id});
      return json({ok:true});
    }
    if(path==='/api/dispatch/pair/request'&&request.method==='POST') {
      const existing=pairKey(request);
      if(existing) {
        const state=await supabaseRpc(env,'nisti_dispatch_pair_status_v5',{p_digest:await digest(existing)});
        if(state?.status==='PENDING')return json({ok:true,...state});
        if(state?.status==='APPROVED')
          return json({ok:true,...state},200,{'set-cookie':monitorCookie(existing)});
      }
      const secret=newMonitorKey();
      const state=await supabaseRpc(env,'nisti_dispatch_request_pair_v5',{p_digest:await digest(secret)});
      return json({ok:true,...state},201,{'set-cookie':pairCookie(secret)});
    }
    if(path==='/api/dispatch/pair/status'&&request.method==='POST') {
      const secret=pairKey(request);
      if(!secret)return json({error:'Solicitação não iniciada.'},401);
      const state=await supabaseRpc(env,'nisti_dispatch_pair_status_v5',{p_digest:await digest(secret)});
      if(!state||state.status==='EXPIRED')return json({error:'Solicitação expirada.'},401);
      if(state.status==='APPROVED')
        return json({ok:true,...state},200,{'set-cookie':monitorCookie(secret)});
      return json({ok:true,...state});
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
      return json({ok:true},200,{'set-cookie':monitorCookie(key)});
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