import app from './gtin-router.js';
import { handleCommerceAdminRequest } from './commerce-admin-router.js';
import {
  operatorPinRequired,operatorPinSessionInfo,verifyOperatorPin,handleOperatorPinAdminRequest
} from './operator-pin-access.js';
import { handleCommerceUpdateAdminRequest } from './commerce-update-admin-router.js';
import { handleCommerceListingStateRequest } from './commerce-listing-state-router.js';
import { handleCommerceProductStateRequest } from './commerce-product-state-router.js';
import { handleCommerceListingEditorRequest } from './commerce-listing-editor-router.js';
import { handleMuralRequest } from './mural-router.js';
import { handleCanvaBridgeRequest } from './canva-bridge-entry.js';

const COOKIE_NAME = 'nisti_admin_session';
const LOGIN_CSRF_COOKIE = '__Host-nisti_login_csrf';
const SESSION_SECONDS = 60 * 60 * 12;
const ADMIN_APP_PATH = '/admin';
const COMMERCE_ADMIN_APP_PATH = '/admin-commerce';
const MUTATING_METHODS = new Set(['POST','PUT','PATCH','DELETE']);
const LOGIN_FAILURE_DELAY_MS = 275;
const OPERATOR_COOKIE_NAME = 'nisti_operator_session';
const OPERATOR_SESSION_SECONDS = 60 * 60 * 12;
const OPERATOR_PIN_LOGIN_PATH = '/api/operator/login';
const OPERATOR_PIN_SESSION_PATH = '/api/operator/session';
const OPERATOR_PIN_LOGOUT_PATH = '/api/operator/logout';
let operatorPinPolicyCache={expires:0,required:null};
async function currentOperatorPinRequired(env){
  // Unit tests/local development without Supabase do not require PIN until configured.
  // Production must always obtain an authoritative answer from the database.
  if(!env?.SUPABASE_URL&&String(env?.APP_ENV||'')!=='production')return false;
  if(Date.now()<operatorPinPolicyCache.expires&&operatorPinPolicyCache.required!==null)
    return operatorPinPolicyCache.required;
  const required=await operatorPinRequired(env);
  operatorPinPolicyCache={expires:Date.now()+3000,required};
  return required;
}
function operatorApiNeedsPin(path){
  if(!path.startsWith('/api/')||path.startsWith('/api/admin/'))return false;
  if(path==='/api/health'||path==='/api/platforms'
    ||path==='/api/mural/access'||path==='/api/push/public-key')return false;
  if(/^\/api\/(?:images|product-images|mural-product-images|reference-images)\//.test(path))return false;
  return true;
}
const CANVA_ART_CREATE_PATH = '/api/admin/canva/art/create';

function base64url(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ''));
}

async function hmac(secret, value) {
  const keyMaterial = await crypto.subtle.digest('SHA-256', textBytes(`nisti-admin:${secret}`));
  const key = await crypto.subtle.importKey('raw', keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, textBytes(value)));
}

async function secureEqualText(a, b) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', textBytes(a)),
    crypto.subtle.digest('SHA-256', textBytes(b))
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function sessionSigningSecret(env) {
  const password=String(env?.ADMIN_PASSWORD||'');
  if(!password)return '';
  const dedicated=String(env?.ADMIN_SESSION_SECRET||'').trim();
  return dedicated ? `${dedicated}:${password}` : password;
}

async function createSession(secret) {
  const payload = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, nonce: crypto.randomUUID() });
  const encoded = base64url(textBytes(payload));
  const signature = base64url(await hmac(secret, encoded));
  return `${encoded}.${signature}`;
}

async function validSession(request, env) {
  const secret = sessionSigningSecret(env);
  if (!secret) return false;
  const token = readCookie(request, COOKIE_NAME);
  if (!token || !token.includes('.')) return false;
  const [payloadEncoded, signatureEncoded] = token.split('.', 2);
  try {
    const expected = await hmac(secret, payloadEncoded);
    const actual = fromBase64url(signatureEncoded);
    if (expected.length !== actual.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
    if (diff !== 0) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(payloadEncoded)));
    return Number(payload?.exp || 0) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function operatorHmac(env, value) {
  const secret=sessionSigningSecret(env);
  if(!secret)return null;
  const keyMaterial=await crypto.subtle.digest('SHA-256',textBytes(`nisti-operator:${secret}`));
  const key=await crypto.subtle.importKey('raw',keyMaterial,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,textBytes(value)));
}

async function createOperatorSession(env,account=null) {
  const id=account?.id||`op_${crypto.randomUUID()}`;
  const exp=Math.floor(Date.now()/1000)+OPERATOR_SESSION_SECONDS;
  const payload=base64url(textBytes(JSON.stringify({
    id,exp,...(account?{pin:1,version:Number(account.version)}:{})
  })));
  const signature=await operatorHmac(env,payload);
  if(!signature)return null;
  return {id,token:`${payload}.${base64url(signature)}`};
}

async function readOperatorSession(request,env) {
  const token=readCookie(request,OPERATOR_COOKIE_NAME);
  if(!token||!token.includes('.'))return null;
  const [payloadEncoded,signatureEncoded]=token.split('.',2);
  try{
    const expected=await operatorHmac(env,payloadEncoded);
    if(!expected)return null;
    const actual=fromBase64url(signatureEncoded);
    if(expected.length!==actual.length)return null;
    let diff=0;
    for(let i=0;i<expected.length;i++)diff|=expected[i]^actual[i];
    if(diff!==0)return null;
    const payload=JSON.parse(new TextDecoder().decode(fromBase64url(payloadEncoded)));
    const id=String(payload?.id||'');
    if(!/^op_[0-9a-f-]{36}$/i.test(id))return null;
    if(Number(payload?.exp||0)<=Math.floor(Date.now()/1000))return null;
    return {id,token,pin:payload.pin===1,version:Number(payload.version||0)};
  }catch{
    return null;
  }
}

async function verifiedOperatorRequest(request,env,pinRequired=false) {
  if(!new URL(request.url).pathname.startsWith('/api/'))return {request,setCookie:null,authorized:true};
  if(new URL(request.url).pathname.startsWith('/api/admin/'))return {request,setCookie:null,authorized:true};
  let session=await readOperatorSession(request,env);
  let setCookie=null,verifiedName=null;
  if(pinRequired){
    if(!session?.pin||!Number.isInteger(session.version)||session.version<1)
      return {request,setCookie:null,authorized:false};
    const account=await operatorPinSessionInfo(env,session.id);
    if(!account||Number(account.version)!==session.version)
      return {request,setCookie:null,authorized:false};
    verifiedName=String(account.name);
  }else if(!session){
    session=await createOperatorSession(env);
    if(!session)return {request,setCookie:null,authorized:true};
    setCookie=`${OPERATOR_COOKIE_NAME}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${OPERATOR_SESSION_SECONDS}`;
  }
  const headers=new Headers(request.headers);
  if(session?.id)headers.set('x-user-id',session.id);
  else headers.delete('x-user-id');
  if(verifiedName)headers.set('x-operator-name',encodeURIComponent(verifiedName));
  const secured=new Request(request,{headers});
  return {request:secured,setCookie,authorized:true};
}

function attachOperatorCookie(response,setCookie) {
  if(!setCookie||!(response instanceof Response))return response;
  const headers=new Headers(response.headers);
  headers.append('set-cookie',setCookie);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

function loginPage(message = '', csrfToken = '') {
  const safe = String(message || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>NISTI ID · Administração</title><style>*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:#f3f4f6;color:#111827;min-height:100vh;display:grid;place-items:center;padding:20px}.card{width:min(420px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:22px;padding:28px;box-shadow:0 18px 50px rgba(17,24,39,.10)}.brand{font-size:11px;font-weight:900;letter-spacing:.16em;color:#6b7280;margin:0 0 8px}h1{font-size:28px;margin:0 0 8px}p{color:#6b7280;line-height:1.5;margin:0 0 20px}label{display:grid;gap:8px;font-size:13px;font-weight:800}input{width:100%;padding:14px 15px;border:1px solid #d1d5db;border-radius:12px;font:inherit}button{width:100%;margin-top:14px;border:0;border-radius:12px;padding:14px 16px;font:inherit;font-weight:900;background:#111827;color:#fff}.error{padding:11px 12px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:10px;margin-bottom:16px;font-size:13px}.back{display:block;text-align:center;margin-top:16px;color:#6b7280;text-decoration:none;font-size:13px}</style></head><body><main class="card"><p class="brand">NISTI ID</p><h1>Área administrativa</h1><p>Acesso restrito. Somente pessoas autorizadas podem abrir o painel administrativo.</p>${safe ? `<div class="error">${safe}</div>` : ''}<form method="post" action="/admin-login"><input type="hidden" name="csrf_token" value="${csrfToken}"><label>Senha administrativa<input type="password" name="password" required autofocus autocomplete="current-password"></label><button type="submit">Entrar na administração</button></form><a class="back" href="/">Voltar ao Painel Geral</a></main></body></html>`;
}

function newLoginCsrfToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
function loginCsrfCookie(token) {
  return `${LOGIN_CSRF_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=900`;
}
function loginCsrfTokenFromCookie(request) {
  const token=readCookie(request,LOGIN_CSRF_COOKIE)||'';
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}
async function validLoginCsrf(request) {
  const cookie=loginCsrfTokenFromCookie(request);
  if(!cookie) return false;
  const form=await request.clone().formData().catch(()=>null);
  return Boolean(form && await secureEqualText(String(form.get('csrf_token')||''),cookie));
}
function loginHtml(request,message='',status=200) {
  const token=loginCsrfTokenFromCookie(request)||newLoginCsrfToken();
  const response=html(loginPage(message,token),status);
  response.headers.append('set-cookie',loginCsrfCookie(token));
  return withSecurityHeaders(response);
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, private', 'x-robots-tag': 'noindex, nofollow' } });
}

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  for (const [name, value] of Object.entries(extraHeaders || {})) {
    headers.set(name, String(value));
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function rateLimitKey(request, scope) {
  const clientIp = String(request.headers.get('CF-Connecting-IP') || 'anonymous')
    .trim()
    .slice(0, 128) || 'anonymous';
  return `${scope}:${clientIp}`;
}

async function enforceRateLimit(env, request, pathname) {
  const method = String(request.method || '').toUpperCase();
  const loginRequest = (pathname === '/admin-login' || pathname === OPERATOR_PIN_LOGIN_PATH)
    && method === 'POST';
  const canvaArtCreateRequest = pathname === CANVA_ART_CREATE_PATH && method === 'POST';
  const apiRequest = pathname.startsWith('/api/');
  if (!loginRequest && !apiRequest) return null;

  const bindingName = loginRequest
    ? 'LOGIN_RATE_LIMITER'
    : canvaArtCreateRequest
      ? 'CANVA_ART_RATE_LIMITER'
      : 'GLOBAL_RATE_LIMITER';
  const binding = env?.[bindingName];
  // A production login must never become unlimited when its rate-limit binding
  // is accidentally missing. Other APIs keep their existing availability policy.
  if (!binding || typeof binding.limit !== 'function') {
    return loginRequest && String(env?.APP_ENV||'').trim().toLowerCase()==='production'
      ? withSecurityHeaders(json({error:'Login temporariamente indisponível.'},503))
      : null;
  }

  const scope = loginRequest
    ? pathname===OPERATOR_PIN_LOGIN_PATH?'operator-pin-login':'admin-login'
    : canvaArtCreateRequest ? 'canva-art-create' : 'api';
  try {
    const result = await binding.limit({ key: rateLimitKey(request, scope) });
    if (result?.success === false) {
      return withSecurityHeaders(
        json(
          { error: 'Muitas requisições. Tente novamente em instantes.' },
          429,
          { 'retry-after': '60' }
        )
      );
    }
  } catch (error) {
    console.error('[Rate limit] Falha ao consultar binding do Cloudflare', error?.message || error);
    if(loginRequest)return withSecurityHeaders(json({error:'Login temporariamente indisponível.'},503));
  }
  return null;
}

const OFFICIAL_NISTI_ORIGINS = new Set([
  'https://admin.sistemanistiid.online',
  'https://sistemanistiid.online'
]);

function sameOriginMutationAllowed(request) {
  if (!MUTATING_METHODS.has(String(request.method || '').toUpperCase())) return true;
  const requestUrl = new URL(request.url);
  const origin = String(request.headers.get('origin') || '').trim();
  const fetchSite = String(request.headers.get('sec-fetch-site') || '').trim().toLowerCase();
  if (origin === 'null' || fetchSite === 'cross-site') return false;

  // Some browsers/proxies report same-site for the official admin login.
  // Trust this case only for the login form and only for known NISTI origins.
  const officialLogin = requestUrl.pathname === '/admin-login'
    && request.method === 'POST'
    && OFFICIAL_NISTI_ORIGINS.has(requestUrl.origin);
  if (officialLogin) {
    if (origin && !OFFICIAL_NISTI_ORIGINS.has(origin)) return false;
    if (fetchSite && !['same-origin','same-site','none'].includes(fetchSite)) return false;
    return true;
  }

  // All API mutations continue to require exact same origin, not same-site.
  if (origin && origin !== requestUrl.origin) return false;
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  return true;
}

function withSecurityHeaders(response) {
  if (!(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options','nosniff');
  headers.set('x-frame-options','DENY');
  headers.set('referrer-policy','no-referrer');
  headers.set('permissions-policy','camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set('cross-origin-opener-policy','same-origin');
  headers.set('strict-transport-security','max-age=31536000; includeSubDomains');
  if (!headers.has('cross-origin-resource-policy')) headers.set('cross-origin-resource-policy','same-origin');

  const contentType = String(headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    headers.set(
      'content-security-policy',
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https:; connect-src 'self' https://api.canva.com https://www.canva.com; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; worker-src 'self' blob:; manifest-src 'self'"
    );
  }

  return new Response(response.body, {
    status:response.status,
    statusText:response.statusText,
    headers
  });
}

function delayedLoginFailure(request, message, status = 401) {
  return new Promise(resolve => setTimeout(() => resolve(loginHtml(request,message,status)), LOGIN_FAILURE_DELAY_MS));
}

function isProtectedApi(pathname) {
  if (pathname.startsWith('/api/admin/')) return true;
  if (pathname === '/api/products' || pathname.startsWith('/api/products/')) return true;
  if (pathname.startsWith('/api/sku/')) return true;
  return false;
}

async function serveProtectedAdminApp(request, env, url) {
  if (!(await validSession(request, env))) return withSecurityHeaders(Response.redirect(new URL('/admin-login', url), 302));
  const response=await env.ASSETS.fetch(new Request(new URL('/', url), { headers: request.headers }));
  const headers=new Headers(response.headers);
  headers.set('cache-control','no-store, private');
  return withSecurityHeaders(new Response(response.body,{status:response.status,statusText:response.statusText,headers}));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Mural's public hostname is a distinct application surface, not a second
    // URL that exposes the Scanner or protected administration endpoints.
    if (url.hostname === 'mural.sistemanistiid.online') {
      if (pathname.startsWith('/api/')) {
        const muralApi = pathname === '/api/mural' || pathname.startsWith('/api/mural/')
          || pathname===OPERATOR_PIN_LOGIN_PATH||pathname===OPERATOR_PIN_SESSION_PATH
          || pathname===OPERATOR_PIN_LOGOUT_PATH;
        const publicImage = request.method === 'GET' && (
          pathname.startsWith('/api/images/')
          || pathname.startsWith('/api/reference-images/')
        );
        if (!muralApi && !publicImage) {
          return withSecurityHeaders(json({error:'Esta URL é exclusiva do Mural NISTI.'},404));
        }
      }
      if (pathname === '/admin' || pathname.startsWith('/admin/')
        || pathname === '/admin-login' || pathname === '/admin-logout'
        || pathname === '/admin-commerce' || pathname.startsWith('/admin-commerce/')) {
        return withSecurityHeaders(json({error:'Esta URL é exclusiva do Mural NISTI.'},404));
      }
      if (request.method === 'GET' && (pathname === '/mural' || pathname === '/index.html')) {
        return withSecurityHeaders(await env.ASSETS.fetch(new Request(new URL('/',url),{
          headers:request.headers
        })));
      }
    }

    // Opening the bookmarked /mural address on the primary operator hostname
    // must also mount the Mural-only frontend instead of returning an asset 404.
    if (request.method === 'GET' && pathname === '/mural') {
      return withSecurityHeaders(await env.ASSETS.fetch(new Request(new URL('/',url),{
        headers:request.headers
      })));
    }

    // Root of the dedicated administrative hostname must never serve the operator scanner.
    // Reuse the existing protected /admin route for authentication and session handling.
    if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')
      && url.hostname === 'admin.sistemanistiid.online') {
      return withSecurityHeaders(Response.redirect(new URL(ADMIN_APP_PATH, url), 302));
    }

    if ((pathname === ADMIN_APP_PATH || pathname === COMMERCE_ADMIN_APP_PATH) && request.method === 'GET') {
      return serveProtectedAdminApp(request, env, url);
    }

    // The admin login relies on a host-only CSRF cookie and hidden form token.
    // Only API requests use strict Origin / Fetch Metadata verification.
    if (pathname === '/admin-login' && request.method === 'POST') {
      if (!(await validLoginCsrf(request))) {
        return loginHtml(request,'Sessão de login expirada. Atualize a página e tente novamente.',403);
      }
    } else if ((pathname === '/admin-login' || pathname === '/admin-logout' || pathname.startsWith('/api/')) && !sameOriginMutationAllowed(request)) {
      return withSecurityHeaders(json({ error:'Origem da solicitação não autorizada.' },403));
    }

    const rateLimitResponse = await enforceRateLimit(env, request, pathname);
    if (rateLimitResponse) return rateLimitResponse;

    if (pathname === '/admin-login' && request.method === 'GET') {
      if (await validSession(request, env)) return withSecurityHeaders(Response.redirect(new URL(ADMIN_APP_PATH, url), 302));
      return loginHtml(request,env.ADMIN_PASSWORD ? '' : 'A administração ainda não foi ativada. Configure o segredo ADMIN_PASSWORD no Cloudflare.');
    }

    if (pathname === '/admin-login' && request.method === 'POST') {
      const configured = String(env.ADMIN_PASSWORD || '');
      if (!configured) return loginHtml(request,'A administração está bloqueada até o segredo ADMIN_PASSWORD ser configurado no Cloudflare.',503);
      const form = await request.formData();
      const supplied = String(form.get('password') || '');
      if (!supplied || !(await secureEqualText(supplied, configured))) return delayedLoginFailure(request,'Senha incorreta.',401);
      const token = await createSession(sessionSigningSecret(env));
      return withSecurityHeaders(new Response(null, { status: 302, headers: { location: ADMIN_APP_PATH, 'set-cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`, 'cache-control': 'no-store' } }));
    }

    if (pathname === '/admin-logout') {
      // State-changing logout is POST-only. GET navigation (including external
      // links and prefetch) must never clear an HttpOnly admin session.
      if(request.method!=='POST'){
        return withSecurityHeaders(json({error:'Use o botão Sair para encerrar a sessão.'},405,{'allow':'POST'}));
      }
      return withSecurityHeaders(new Response(null, { status: 303, headers: { location: '/', 'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`, 'cache-control': 'no-store' } }));
    }

    if (isProtectedApi(pathname) && !(await validSession(request, env))) {
      return withSecurityHeaders(json({ error: 'Acesso administrativo não autorizado.' }, 401));
    }

    // Public operator login requires only an eight-digit PIN. No client-supplied
    // x-user-id or x-operator-name is trusted once PIN enforcement is active.
    if(pathname===OPERATOR_PIN_SESSION_PATH&&request.method==='GET'){
      try{
        const required=await currentOperatorPinRequired(env);
        if(!required)return withSecurityHeaders(json({required:false,authenticated:false}));
        const session=await readOperatorSession(request,env);
        const account=session?.pin?await operatorPinSessionInfo(env,session.id):null;
        const authenticated=!!account&&Number(account.version)===session.version;
        return withSecurityHeaders(json(authenticated
          ?{required:true,authenticated:true,name:account.name}
          :{required:true,authenticated:false}));
      }catch{
        return withSecurityHeaders(json({error:'Verificação de acesso indisponível.'},503));
      }
    }
    if(pathname===OPERATOR_PIN_LOGIN_PATH&&request.method==='POST'){
      try{
        const body=await request.json().catch(()=>null);
        const pin=body?.pin;
        const account=await verifyOperatorPin(env,pin);
        if(!account){
          await new Promise(resolve=>setTimeout(resolve,250));
          return withSecurityHeaders(json({error:'PIN inválido.'},401));
        }
        const operatorSession=await createOperatorSession(env,account);
        if(!operatorSession)return withSecurityHeaders(json({error:'Acesso indisponível.'},503));
        return withSecurityHeaders(new Response(JSON.stringify({ok:true,name:account.name}),{
          status:200,headers:{
            'content-type':'application/json; charset=utf-8','cache-control':'no-store, private',
            'set-cookie':`${OPERATOR_COOKIE_NAME}=${operatorSession.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${OPERATOR_SESSION_SECONDS}`
          }
        }));
      }catch(error){
        console.error('[Operator PIN] Falha no serviço de login',error?.name||'error');
        return withSecurityHeaders(json({error:'Acesso por PIN indisponível.'},503));
      }
    }
    if(pathname===OPERATOR_PIN_LOGOUT_PATH&&request.method==='POST'){
      return withSecurityHeaders(new Response(JSON.stringify({ok:true}),{
        status:200,headers:{'content-type':'application/json; charset=utf-8',
          'cache-control':'no-store','set-cookie':`${OPERATOR_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`}
      }));
    }
    const pinAdmin=await handleOperatorPinAdminRequest(request,env);
    if(pinAdmin)return withSecurityHeaders(pinAdmin);

    let operatorContext;
    try{
      const required=operatorApiNeedsPin(pathname)
        ?await currentOperatorPinRequired(env):false;
      operatorContext=await verifiedOperatorRequest(request,env,required);
      if(!operatorContext.authorized)
        return withSecurityHeaders(json({error:'Informe o PIN do operador para continuar.',code:'operator_pin_required'},401));
    }catch(error){
      console.error('[Operator PIN] Falha na verificação de sessão',error?.name||'error');
      return withSecurityHeaders(json({error:'Autenticação do operador indisponível.'},503));
    }
    request=operatorContext.request;

    const canvaResponse = await handleCanvaBridgeRequest(request, env);
    if (canvaResponse) return withSecurityHeaders(canvaResponse);

    const muralQaRequested = request.headers.get('x-mural-qa') === '1';
    const muralQaAsset = request.method === 'GET' && (
      /^\/api\/mural\/images\/\d+$/.test(pathname)
      || /^\/api\/mural\/collections\/[^/]+\/image$/.test(pathname)
    );
    const muralQaSession = pathname.startsWith('/api/mural') && (muralQaRequested || muralQaAsset)
      ? await validSession(request, env)
      : false;
    const muralResponse = await handleMuralRequest(request, env, { qaAuthorized: muralQaSession });
    if (muralResponse) return withSecurityHeaders(attachOperatorCookie(muralResponse,operatorContext.setCookie));

    const listingEditorResponse = await handleCommerceListingEditorRequest(request, env);
    if (listingEditorResponse) return withSecurityHeaders(listingEditorResponse);

    const productStateResponse = await handleCommerceProductStateRequest(request, env);
    if (productStateResponse) return withSecurityHeaders(productStateResponse);

    const listingStateResponse = await handleCommerceListingStateRequest(request, env);
    if (listingStateResponse) return withSecurityHeaders(listingStateResponse);

    const commerceUpdateResponse = await handleCommerceUpdateAdminRequest(request, env);
    if (commerceUpdateResponse) return withSecurityHeaders(commerceUpdateResponse);

    const commerceResponse = await handleCommerceAdminRequest(request, env);
    if (commerceResponse) return withSecurityHeaders(commerceResponse);

    return withSecurityHeaders(attachOperatorCookie(await app.fetch(request, env, ctx),operatorContext.setCookie));
  }
};
