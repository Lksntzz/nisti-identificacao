import {handleNotificationDispatchRequest} from './notification-dispatch-router.js';

// A URL privada permite envio, consulta da fila e personalização das modalidades.
// Nunca autoriza pareamento, chaves do monitor ou APIs administrativas gerais.
const COOKIE='__Host-nisti_dispatch_sender';
const COOKIE_AGE=60*60*24*30;
const API='/api/expedition-panel';

function json(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store, private',
    ...headers
  }});
}
function tokenFromCookie(request){
  const cookies=String(request.headers.get('cookie')||'').split(';');
  const item=cookies.find(x=>x.trim().startsWith(COOKIE+'='));
  return item?.trim().slice(COOKIE.length+1)||'';
}
async function tokenDigest(token){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
}
async function validToken(token,env){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return false;
  const expected=String(env?.DISPATCH_SENDER_TOKEN_SHA256||'').trim();
  if(!/^[a-f0-9]{64}$/.test(expected))return false;
  const computed=await tokenDigest(token);
  let diff=0;
  for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^computed.charCodeAt(i);
  return diff===0;
}
function cookie(value,age){
  return COOKIE+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+age;
}

// Abre em qualquer PC sem senha: o Worker verifica a chave do link compartilhado,
// cria cookie HttpOnly e redireciona imediatamente ao endereço sem chave.
// Nenhuma chave privada é exposta em HTML, scripts ou nas respostas.
export async function activateDispatchSenderLink(request,env){
  const url=new URL(request.url);
  if(request.method!=='GET')return null;
  const invitation=url.pathname.match(/^\/convite-expedicao\/([0-9a-f]{64})$/);
  const queryLink=url.pathname==='/painel-expedicao'&&url.searchParams.has('acesso');
  if(!invitation&&!queryLink)return null;
  const key=invitation?.[1]||url.searchParams.get('acesso')||'';
  const headers=new Headers({
    'cache-control':'no-store, private',
    'referrer-policy':'no-referrer',
    'x-robots-tag':'noindex, nofollow'
  });
  if(!(await validToken(key,env))){
    return json({error:'Link privado inválido ou revogado. Solicite o endereço atualizado.'},403,{
      'referrer-policy':'no-referrer',
      'x-robots-tag':'noindex, nofollow'
    });
  }
  // Uma página de transição no próprio domínio garante que o navegador
  // finalize a gravação do cookie SameSite=Strict antes de ir ao painel.
  // Redirecionamentos de um clique em outros aplicativos podem preservar
  // o contexto cross-site e ocultar cookies Strict no primeiro carregamento.
  headers.set('content-type','text/html; charset=utf-8');
  headers.set('set-cookie',cookie(key,COOKIE_AGE));
  return new Response(
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'+
    '<meta name="referrer" content="no-referrer">'+
    '<meta http-equiv="refresh" content="0;url=/painel-expedicao">'+
    '<title>Abrindo painel NISTI</title></head><body>'+
    '<p>Abrindo Central de Notificações da Expedição… '+
    '<a href="/painel-expedicao">Continuar</a></p></body></html>',
    {status:200,headers}
  );
}

export async function handleDispatchSenderRequest(request,env){
  const url=new URL(request.url);
  const path=url.pathname;
  if(path!==API&&!path.startsWith(API+'/'))return null;

  if(path===API+'/activate'&&request.method==='POST'){
    const body=await request.json().catch(()=>null);
    const token=String(body?.token||'').trim().toLowerCase();
    if(!(await validToken(token,env)))return json({error:'Link privado inválido ou revogado.'},401);
    return json({ok:true},200,{'set-cookie':cookie(token,COOKIE_AGE)});
  }
  if(path===API+'/logout'&&request.method==='POST')
    return json({ok:true},200,{'set-cookie':cookie('',0)});

  const valid=await validToken(tokenFromCookie(request),env);
  if(path===API+'/session'&&request.method==='GET')return json({authorized:valid});

  if(!valid)return json({error:'Acesso restrito. Utilize o link privado da expedição.'},401);

  // Lista EXAUSTIVA de permissões da URL privada.
  const dispatchPath=path===API&&request.method==='GET'?'/api/admin/dispatch'
    :path===API+'/options'&&(request.method==='GET'||request.method==='POST')?'/api/admin/dispatch/options'
    :path===API+'/batch'&&request.method==='POST'?'/api/admin/dispatch/batch'
    :null;
  if(!dispatchPath)return json({error:'Ação não autorizada nesta URL.'},403);

  const translated=new URL(request.url);
  translated.pathname=dispatchPath;
  const forwarding=new Request(translated,request);
  return handleNotificationDispatchRequest(forwarding,env);
}
