import app from './gtin-router.js';
import { handleCommerceAdminRequest } from './commerce-admin-router.js';
import { handleCommerceUpdateAdminRequest } from './commerce-update-admin-router.js';
import { handleCommerceListingStateRequest } from './commerce-listing-state-router.js';
import { handleCommerceProductStateRequest } from './commerce-product-state-router.js';
import { handleCommerceListingEditorRequest } from './commerce-listing-editor-router.js';
import { handleMuralRequest } from './mural-router.js';
import { handleCanvaBridgeRequest } from './canva-bridge-entry.js';

const COOKIE_NAME = 'nisti_admin_session';
const SESSION_SECONDS = 60 * 60 * 12;
const ADMIN_APP_PATH = '/admin';
const COMMERCE_ADMIN_APP_PATH = '/admin-commerce';
const MUTATING_METHODS = new Set(['POST','PUT','PATCH','DELETE']);
const LOGIN_FAILURE_DELAY_MS = 275;
const OPERATOR_COOKIE_NAME = 'nisti_operator_session';
const OPERATOR_SESSION_SECONDS = 60 * 60 * 24 * 180;

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

async function createOperatorSession(env) {
  const id=`op_${crypto.randomUUID()}`;
  const exp=Math.floor(Date.now()/1000)+OPERATOR_SESSION_SECONDS;
  const payload=base64url(textBytes(JSON.stringify({id,exp})));
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
    return {id,token};
  }catch{
    return null;
  }
}

async function verifiedOperatorRequest(request,env) {
  if(!new URL(request.url).pathname.startsWith('/api/'))return {request,setCookie:null};
  if(new URL(request.url).pathname.startsWith('/api/admin/'))return {request,setCookie:null};

  let session=await readOperatorSession(request,env);
  let setCookie=null;
  if(!session){
    session=await createOperatorSession(env);
    if(!session)return {request,setCookie:null};
    setCookie=`${OPERATOR_COOKIE_NAME}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${OPERATOR_SESSION_SECONDS}`;
  }

  const headers=new Headers(request.headers);
  headers.set('x-user-id',session.id);
  const secured=new Request(request,{headers});
  return {request:secured,setCookie};
}

function attachOperatorCookie(response,setCookie) {
  if(!setCookie||!(response instanceof Response))return response;
  const headers=new Headers(response.headers);
  headers.append('set-cookie',setCookie);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

function loginPage(message = '') {
  const safe = String(message || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>NISTI ID · Administração</title><style>*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:#f3f4f6;color:#111827;min-height:100vh;display:grid;place-items:center;padding:20px}.card{width:min(420px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:22px;padding:28px;box-shadow:0 18px 50px rgba(17,24,39,.10)}.brand{font-size:11px;font-weight:900;letter-spacing:.16em;color:#6b7280;margin:0 0 8px}h1{font-size:28px;margin:0 0 8px}p{color:#6b7280;line-height:1.5;margin:0 0 20px}label{display:grid;gap:8px;font-size:13px;font-weight:800}input{width:100%;padding:14px 15px;border:1px solid #d1d5db;border-radius:12px;font:inherit}button{width:100%;margin-top:14px;border:0;border-radius:12px;padding:14px 16px;font:inherit;font-weight:900;background:#111827;color:#fff}.error{padding:11px 12px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:10px;margin-bottom:16px;font-size:13px}.back{display:block;text-align:center;margin-top:16px;color:#6b7280;text-decoration:none;font-size:13px}</style></head><body><main class="card"><p class="brand">NISTI ID</p><h1>Área administrativa</h1><p>Acesso restrito. Somente pessoas autorizadas podem abrir o painel administrativo.</p>${safe ? `<div class="error">${safe}</div>` : ''}<form method="post" action="/admin-login"><label>Senha administrativa<input type="password" name="password" required autofocus autocomplete="current-password"></label><button type="submit">Entrar na administração</button></form><a class="back" href="/">Voltar ao Painel Geral</a></main></body></html>`;
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, private', 'x-robots-tag': 'noindex, nofollow' } });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function sameOriginMutationAllowed(request) {
  if (!MUTATING_METHODS.has(String(request.method || '').toUpperCase())) return true;
  const requestUrl = new URL(request.url);
  const origin = String(request.headers.get('origin') || '').trim();
  if (origin && origin !== requestUrl.origin) return false;
  const fetchSite = String(request.headers.get('sec-fetch-site') || '').trim().toLowerCase();
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
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https:; connect-src 'self' https://yioetdcbgorunwgwuawg.supabase.co https://api.canva.com https://www.canva.com; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; worker-src 'self' blob:; manifest-src 'self'"
    );
  }

  return new Response(response.body, {
    status:response.status,
    statusText:response.statusText,
    headers
  });
}

function delayedLoginFailure(message, status = 401) {
  return new Promise(resolve => setTimeout(() => resolve(withSecurityHeaders(html(loginPage(message), status))), LOGIN_FAILURE_DELAY_MS));
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

    if ((pathname === ADMIN_APP_PATH || pathname === COMMERCE_ADMIN_APP_PATH) && request.method === 'GET') {
      return serveProtectedAdminApp(request, env, url);
    }

    if ((pathname === '/admin-login' || pathname.startsWith('/api/')) && !sameOriginMutationAllowed(request)) {
      return withSecurityHeaders(json({ error:'Origem da solicitação não autorizada.' },403));
    }

    if (pathname === '/admin-login' && request.method === 'GET') {
      if (await validSession(request, env)) return withSecurityHeaders(Response.redirect(new URL(ADMIN_APP_PATH, url), 302));
      return withSecurityHeaders(html(loginPage(env.ADMIN_PASSWORD ? '' : 'A administração ainda não foi ativada. Configure o segredo ADMIN_PASSWORD no Cloudflare.')));
    }

    if (pathname === '/admin-login' && request.method === 'POST') {
      const configured = String(env.ADMIN_PASSWORD || '');
      if (!configured) return withSecurityHeaders(html(loginPage('A administração está bloqueada até o segredo ADMIN_PASSWORD ser configurado no Cloudflare.'), 503));
      const form = await request.formData();
      const supplied = String(form.get('password') || '');
      if (!supplied || !(await secureEqualText(supplied, configured))) return delayedLoginFailure('Senha incorreta.', 401);
      const token = await createSession(sessionSigningSecret(env));
      return withSecurityHeaders(new Response(null, { status: 302, headers: { location: ADMIN_APP_PATH, 'set-cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`, 'cache-control': 'no-store' } }));
    }

    if (pathname === '/admin-logout') {
      return withSecurityHeaders(new Response(null, { status: 302, headers: { location: '/', 'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`, 'cache-control': 'no-store' } }));
    }

    if (isProtectedApi(pathname) && !(await validSession(request, env))) {
      return withSecurityHeaders(json({ error: 'Acesso administrativo não autorizado.' }, 401));
    }

    const operatorContext=await verifiedOperatorRequest(request,env);
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
