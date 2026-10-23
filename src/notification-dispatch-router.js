import { supabaseRpc } from './supabase-read-store.js';
import { DISPATCH_PLATFORMS,dispatchOptionValid } from './notification-dispatch-options.js';

export { DISPATCH_PLATFORMS } from './notification-dispatch-options.js';
function json(value,status=200,headers={}) {
  return new Response(JSON.stringify(value),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store, private',...headers
  }});
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
    // O painel autorizado solicita que o monitor aberto sincronize novamente.
    // Não libera acesso ADM e não abre o navegador de um computador desligado.
    if(path==='/api/admin/dispatch/connect'&&request.method==='POST') {
      const result=await supabaseRpc(env,'nisti_dispatch_request_reconnect_v7',{});
      return json({ok:true,...result});
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
    // A consulta de exibição é pública. O servidor controla a fila de 15s;
    // esta rota NÃO permite enviar, editar, aprovar ou administrar notificações.
    if(path==='/api/dispatch/view'&&request.method==='POST') {
      const data=await supabaseRpc(env,'nisti_dispatch_public_next_v8',{});
      return json({ok:true,...data});
    }
    return json({error:'Rota ou método não permitido.'},405,{'allow':'GET, POST'});
  }catch(error){return errorResponse(error)}
}