// GA - Gestor de Anúncio: endereço próprio com login e sessão próprios.
// Só expõe o Painel Comercial; nenhuma rota do painel administrativo NISTI ID,
// do Scanner ou do Mural funciona neste hostname. A sessão do GA usa outra senha,
// outro segredo de assinatura e outro cookie: uma sessão do ADM não vale aqui e vice-versa.
export const GA_HOST = 'ga.sistemanistiid.online';
const SESSION_COOKIE = '__Host-nisti_ga_session';
const CSRF_COOKIE = '__Host-nisti_ga_csrf';
const SESSION_SECONDS = 60 * 60 * 12;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FAILURE_DELAY_MS = 275;
const IMAGE_PATH = /^\/api\/(?:images|product-images|reference-images)\//;

const enc = value => new TextEncoder().encode(String(value || ''));

function b64url(bytes) {
  let binary = '';
  for (const byte of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function equalText(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc(a)), crypto.subtle.digest('SHA-256', enc(b))]);
  const left = new Uint8Array(x);
  const right = new Uint8Array(y);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

function signingSecret(env) {
  const password = String(env?.GA_PASSWORD || '');
  if (!password) return '';
  const dedicated = String(env?.GA_SESSION_SECRET || '').trim();
  return dedicated ? `${dedicated}:${password}` : password;
}

async function sign(secret, value) {
  const material = await crypto.subtle.digest('SHA-256', enc(`nisti-ga:${secret}`));
  const key = await crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc(value)));
}

export async function createGaSession(env) {
  const secret = signingSecret(env);
  const payload = b64url(enc(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, nonce: crypto.randomUUID() })));
  return `${payload}.${await sign(secret, payload)}`;
}

function cookie(request, name) {
  for (const part of String(request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

export async function validGaSession(request, env) {
  const secret = signingSecret(env);
  if (!secret) return false;
  const [payload, signature] = cookie(request, SESSION_COOKIE).split('.');
  if (!payload || !signature || !(await equalText(signature, await sign(secret, payload)))) return false;
  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const data = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4 || 4)) % 4)));
    return Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

const escapeHtml = value => String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function loginPage(message, token) {
  const safe = escapeHtml(message);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>GA - Gestor de Anúncio</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;font:16px system-ui,sans-serif;color:#0f172a;padding:16px}
.card{width:100%;max-width:420px;background:#fff;border-radius:18px;padding:34px 30px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
.badge{display:inline-grid;place-items:center;width:46px;height:46px;border-radius:12px;background:#2563eb;color:#fff;font-weight:800;font-size:18px}
h1{margin:14px 0 4px;font-size:24px}p{margin:0 0 22px;color:#475569;font-size:14px}
label{display:block;font-size:13px;font-weight:700;margin-bottom:6px}
input{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px}
button{margin-top:16px;width:100%;padding:13px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;padding:10px 12px;border-radius:10px;font-size:14px;margin-bottom:14px}
</style></head><body><main class="card"><span class="badge" aria-hidden="true">GA</span>
<h1>GA - Gestor de Anúncio</h1><p>Acesso restrito. Digite a senha do GA.</p>
${safe ? `<div class="error" role="alert">${safe}</div>` : ''}
<form method="post" action="/ga-login"><input type="hidden" name="csrf_token" value="${token}">
<label for="pw">Senha</label><input id="pw" type="password" name="password" required autocomplete="current-password" autocapitalize="off" placeholder="Digite sua senha">
<button type="submit">Entrar</button></form></main></body></html>`;
}

function page(body, status = 200, extra = []) {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, private', 'x-robots-tag': 'noindex, nofollow' });
  for (const value of extra) headers.append('set-cookie', value);
  return new Response(body, { status, headers });
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
}

function loginResponse(request, message = '', status = 200) {
  const existing = cookie(request, CSRF_COOKIE);
  const token = /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : b64url(crypto.getRandomValues(new Uint8Array(32)));
  return page(loginPage(message, token), status, [`${CSRF_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=900`]);
}

function sameOrigin(request, url) {
  if (!MUTATING.has(request.method)) return true;
  const origin = String(request.headers.get('origin') || '').trim();
  if (origin === 'null' || String(request.headers.get('sec-fetch-site') || '').toLowerCase() === 'cross-site') return false;
  return !origin || origin === url.origin;
}

async function limit(env, name, request, scope) {
  const binding = env?.[name];
  const production = String(env?.APP_ENV || '').trim().toLowerCase() === 'production';
  if (!binding || typeof binding.limit !== 'function') return production && name === 'LOGIN_RATE_LIMITER' ? json({ error: 'Login temporariamente indisponível.' }, 503) : null;
  const ip = String(request.headers.get('CF-Connecting-IP') || 'anonymous').trim().slice(0, 128) || 'anonymous';
  try {
    const result = await binding.limit({ key: `${scope}:${ip}` });
    if (result?.success === false) return json({ error: 'Muitas requisições. Tente novamente em instantes.' }, 429, { 'retry-after': '60' });
  } catch {
    return name === 'LOGIN_RATE_LIMITER' ? json({ error: 'Login temporariamente indisponível.' }, 503) : null;
  }
  return null;
}

export function isGaApiPath(pathname, method) {
  return pathname === '/api/admin/commerce' || pathname.startsWith('/api/admin/commerce/')
    || (method === 'GET' && IMAGE_PATH.test(pathname));
}

// nextApi(request) executa os handlers comerciais e devolve Response ou null.
export async function handleGaHostRequest(request, env, { secure = r => r, nextApi }) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const done = response => secure(response);

  if (!signingSecret(env)) {
    return done(page(loginPage('O GA ainda não foi ativado. Configure o segredo GA_PASSWORD no Cloudflare.', ''), 503));
  }

  if (pathname === '/ga-login' && method === 'GET') {
    return done((await validGaSession(request, env)) ? Response.redirect(new URL('/', url), 302) : loginResponse(request));
  }

  if (pathname === '/ga-login' && method === 'POST') {
    const limited = await limit(env, 'LOGIN_RATE_LIMITER', request, 'ga-login');
    if (limited) return done(limited);
    const form = await request.formData().catch(() => null);
    const csrf = cookie(request, CSRF_COOKIE);
    if (!form || !csrf || !(await equalText(String(form.get('csrf_token') || ''), csrf))) {
      return done(loginResponse(request, 'Sessão de login expirada. Atualize a página e tente novamente.', 403));
    }
    if (!sameOrigin(request, url)) return done(json({ error: 'Origem da solicitação não autorizada.' }, 403));
    const supplied = String(form.get('password') || '');
    if (!supplied || !(await equalText(supplied, String(env.GA_PASSWORD || '')))) {
      await new Promise(resolve => setTimeout(resolve, FAILURE_DELAY_MS));
      return done(loginResponse(request, 'Senha incorreta.', 401));
    }
    const token = await createGaSession(env);
    return done(new Response(null, { status: 302, headers: {
      location: '/', 'cache-control': 'no-store',
      'set-cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`
    } }));
  }

  if (pathname === '/ga-logout') {
    if (method !== 'POST') return done(json({ error: 'Use o botão Sair para encerrar a sessão.' }, 405, { allow: 'POST' }));
    return done(new Response(null, { status: 303, headers: {
      location: '/ga-login', 'cache-control': 'no-store',
      'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
    } }));
  }

  if (pathname.startsWith('/api/')) {
    if (!isGaApiPath(pathname, method)) return done(json({ error: 'Esta URL é exclusiva do GA - Gestor de Anúncio.' }, 404));
    if (!(await validGaSession(request, env))) return done(json({ error: 'Acesso não autorizado.' }, 401));
    if (!sameOrigin(request, url)) return done(json({ error: 'Origem da solicitação não autorizada.' }, 403));
    const limited = await limit(env, 'GLOBAL_RATE_LIMITER', request, 'ga-api');
    if (limited) return done(limited);
    return done((await nextApi(request)) || json({ error: 'Rota não encontrada.' }, 404));
  }

  if (method !== 'GET' && method !== 'HEAD') return done(json({ error: 'Método não permitido.' }, 405));

  if (pathname === '/' || pathname === '/index.html') {
    if (!(await validGaSession(request, env))) return done(Response.redirect(new URL('/ga-login', url), 302));
    const shell = await env.ASSETS.fetch(new Request(new URL('/', url), { headers: request.headers }));
    const headers = new Headers(shell.headers);
    headers.set('cache-control', 'no-store, private');
    headers.set('x-robots-tag', 'noindex, nofollow');
    return done(new Response(shell.body, { status: shell.status, statusText: shell.statusText, headers }));
  }

  // Arquivos estáticos (JS/CSS/imagens) não contêm dados. Qualquer caminho que caia no
  // fallback do app (HTML) volta para a raiz, para nunca expor outra tela por aqui.
  const asset = await env.ASSETS.fetch(request);
  if (String(asset.headers.get('content-type') || '').includes('text/html')) {
    return done(Response.redirect(new URL('/', url), 302));
  }
  return done(asset);
}
