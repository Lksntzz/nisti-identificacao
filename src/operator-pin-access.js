import { supabaseRpc } from './supabase-read-store.js';

// The PIN never reaches browser storage, logs, or the database in plaintext.
// Cloudflare OPERATOR_PIN_PEPPER must be a dedicated 256-bit secret.
function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store, private',
    'referrer-policy':'no-referrer'
  }});
}
function assertPepper(env){
  const pepper=String(env?.OPERATOR_PIN_PEPPER||'');
  if(pepper.length<32)throw new Error('operator_pin_pepper_unavailable');
  return pepper;
}
export function validOperatorPin(value){
  return typeof value==='string' && /^\d{8}$/.test(value);
}
export async function operatorPinDigest(env,pin){
  if(!validOperatorPin(pin))throw new Error('invalid_operator_pin');
  const secret=assertPepper(env);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('nisti-operator-pin-v1:'+pin)));
  return [...mac].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function newPin(){
  // Rejection sampling avoids bias in the 8-digit random PIN range.
  const cap=Math.floor(4294967296/100000000)*100000000;
  let value;
  do{value=crypto.getRandomValues(new Uint32Array(1))[0]}while(value>=cap);
  return String(value%100000000).padStart(8,'0');
}
export async function operatorPinRequired(env){
  // Never default to anonymous access on an upstream failure.
  return (await supabaseRpc(env,'nisti_operator_pin_required_v1',{}))===true;
}
export async function operatorPinSessionInfo(env,id){
  if(!/^op_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id||'')))return null;
  const row=await supabaseRpc(env,'nisti_operator_pin_session_v1',{p_id:id});
  return row?.id===id&&row?.name&&Number.isInteger(Number(row.version))?row:null;
}
export async function verifyOperatorPin(env,pin){
  if(!validOperatorPin(pin))return null;
  const digest=await operatorPinDigest(env,pin);
  const row=await supabaseRpc(env,'nisti_operator_pin_signin_v1',{p_digest:digest});
  return row?.id&&row?.name&&Number.isInteger(Number(row.version))?row:null;
}
export async function handleOperatorPinAdminRequest(request,env){
  const path=new URL(request.url).pathname,method=request.method;
  if(!path.startsWith('/api/admin/operator-pins'))return null;
  try{
    if(path==='/api/admin/operator-pins'&&method==='GET'){
      return json(await supabaseRpc(env,'nisti_operator_pin_admin_list_v1',{}));
    }
    if(path==='/api/admin/operator-pins'&&method==='POST'){
      const body=await request.json().catch(()=>null);
      const name=String(body?.name||'').trim();
      if(name.length<2||name.length>80)return json({error:'Informe um nome entre 2 e 80 caracteres.'},400);
      const pin=newPin();
      const digest=await operatorPinDigest(env,pin);
      const account=await supabaseRpc(env,'nisti_operator_pin_create_v1',{p_name:name,p_digest:digest});
      // PIN shown exactly once, after successful creation, in the admin-only response.
      return json({ok:true,operator:account,pin},201);
    }
    if(path==='/api/admin/operator-pins/enforce'&&method==='POST'){
      const body=await request.json().catch(()=>null);
      if(typeof body?.required!=='boolean')return json({error:'Escolha ativar ou desativar o PIN.'},400);
      const required=await supabaseRpc(env,'nisti_operator_pin_enforce_v1',{p_required:body.required});
      return json({ok:true,required:required===true});
    }
    const action=path.match(/^\/api\/admin\/operator-pins\/(op_[0-9a-f-]{36})\/(enable|rotate)$/i);
    if(action&&method==='POST'){
      const id=action[1];
      if(action[2]==='enable'){
        const body=await request.json().catch(()=>null);
        if(typeof body?.enabled!=='boolean')return json({error:'Status inválido.'},400);
        const updated=await supabaseRpc(env,'nisti_operator_pin_set_enabled_v1',{p_id:id,p_enabled:body.enabled});
        return json({ok:updated===true},updated===true?200:404);
      }
      const pin=newPin();
      const digest=await operatorPinDigest(env,pin);
      const updated=await supabaseRpc(env,'nisti_operator_pin_rotate_v1',{p_id:id,p_digest:digest});
      return updated===true?json({ok:true,pin}):json({error:'Operador não encontrado ou inativo.'},404);
    }
    return json({error:'Rota ou método não permitido.'},405);
  }catch(error){
    console.error('[PIN Admin] Falha controlada',error?.code||error?.name||'pin_admin_error');
    return json({error:'Não foi possível processar a configuração de PIN.'},503);
  }
}
