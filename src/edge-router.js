import { handleCommerceAdminRequest } from './commerce-admin-router.js';
import { handleCommerceListingStateRequest } from './commerce-listing-state-router.js';
import { handleCommerceProductStateRequest } from './commerce-product-state-router.js';

const COOKIE_NAME = 'nisti_admin_session';
const SESSION_SECONDS = 60 * 60 * 12;
const COMMERCE_APP_PATH = '/admin-commerce';

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

async function createSession(secret) {
  const payload = JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    nonce: crypto.randomUUID()
  });
  const encoded = base64url(textBytes(payload));
  const signature = base64url(await hmac(secret, encoded));
  return `${encoded}.${signature}`;
}

async function validSession(request, env) {
  const secret = String(env.ADMIN_PASSWORD || '');
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

function loginPage(message = '') {
  const safe = String(message || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>NISTI · Catálogo Comercial</title><style>*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:#f8fafc;color:#0f172a;min-height:100vh;display:grid;place-items:center;padding:20px}.card{width:min(420px,100%);background:#fff;border:1px solid #e2e8f0;border-radius:22px;padding:28px;box-shadow:0 18px 50px rgba(15,23,42,.10)}.brand{font-size:11px;font-weight:900;letter-spacing:.16em;color:#64748b;margin:0 0 8px}h1{font-size:28px;margin:0 0 8px}p{color:#64748b;line-height:1.5;margin:0 0 20px}label{display:grid;gap:8px;font-size:13px;font-weight:800}input{width:100%;padding:14px 15px;border:1px solid #cbd5e1;border-radius:12px;font:inherit}button{width:100%;margin-top:14px;border:0;border-radius:12px;padding:14px 16px;font:inherit;font-weight:900;background:#0f172a;color:#fff}.error{padding:11px 12px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:10px;margin-bottom:16px;font-size:13px}</style></head><body><main class="card"><p class="brand">NISTI PRINT</p><h1>Catálogo Comercial</h1><p>Acesso restrito à administração comercial.</p>${safe ? `<div class="error">${safe}</div>` : ''}<form method="post" action="/admin-login"><label>Senha administrativa<input type="password" name="password" required autofocus autocomplete="current-password"></label><button type="submit">Entrar</button></form></main></body></html>`;
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-robots-tag': 'noindex, nofollow'
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function isProtectedApi(pathname) {
  return pathname === '/api/admin/commerce' || pathname.startsWith('/api/admin/commerce/');
}

async function serveCommerceApp(request, env, url) {
  if (!(await validSession(request, env))) {
    return Response.redirect(new URL('/admin-login', url), 302);
  }
  const indexUrl = new URL('/', url);
  return env.ASSETS.fetch(new Request(indexUrl, { headers: request.headers }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = String(request.method || 'GET').toUpperCase();

    if (method === 'GET' && (pathname === '/' || pathname === '/admin')) {
      return Response.redirect(new URL(COMMERCE_APP_PATH, url), 302);
    }

    if (method === 'GET' && pathname === COMMERCE_APP_PATH) {
      return serveCommerceApp(request, env, url);
    }

    if (pathname === '/admin-login' && method === 'GET') {
      if (await validSession(request, env)) {
        return Response.redirect(new URL(COMMERCE_APP_PATH, url), 302);
      }
      return html(loginPage(env.ADMIN_PASSWORD ? '' : 'A administração ainda não foi ativada. Configure ADMIN_PASSWORD no Cloudflare.'));
    }

    if (pathname === '/admin-login' && method === 'POST') {
      const configured = String(env.ADMIN_PASSWORD || '');
      if (!configured) {
        return html(loginPage('A administração está bloqueada até ADMIN_PASSWORD ser configurada.'), 503);
      }

      const form = await request.formData();
      const supplied = String(form.get('password') || '');
      if (!supplied || !(await secureEqualText(supplied, configured))) {
        return html(loginPage('Senha incorreta.'), 401);
      }

      const token = await createSession(configured);
      return new Response(null, {
        status: 302,
        headers: {
          location: COMMERCE_APP_PATH,
          'set-cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
          'cache-control': 'no-store'
        }
      });
    }

    if (pathname === '/admin-logout') {
      return new Response(null, {
        status: 302,
        headers: {
          location: '/admin-login',
          'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
          'cache-control': 'no-store'
        }
      });
    }

    if (isProtectedApi(pathname) && !(await validSession(request, env))) {
      return json({ error: 'Acesso administrativo não autorizado.' }, 401);
    }

    const productStateResponse = await handleCommerceProductStateRequest(request, env);
    if (productStateResponse) return productStateResponse;

    const listingStateResponse = await handleCommerceListingStateRequest(request, env);
    if (listingStateResponse) return listingStateResponse;

    const commerceResponse = await handleCommerceAdminRequest(request, env);
    if (commerceResponse) return commerceResponse;

    if (pathname.startsWith('/api/')) {
      return json({ error: 'Rota não encontrada.' }, 404);
    }

    if (method === 'GET' && (request.headers.get('accept') || '').includes('text/html')) {
      return Response.redirect(new URL(COMMERCE_APP_PATH, url), 302);
    }

    return env.ASSETS.fetch(request);
  }
};
