import { supabaseRpc } from './supabase-read-store.js';

const CANVA_AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize';
const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const CANVA_API_URL = 'https://api.canva.com/rest/v1';
const CANVA_SCOPES = Object.freeze(['asset:read','asset:write','profile:read']);
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;

class CanvaBridgeError extends Error {
  constructor(message, { status = 500, code = 'canva_bridge_error' } = {}) {
    super(message);
    this.name = 'CanvaBridgeError';
    this.status = status;
    this.code = code;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'
    }
  });
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g,'+').replace(/_/g,'/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function randomToken(byteLength = 64) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(secret || '')));
  return crypto.subtle.importKey('raw', digest, { name:'AES-GCM' }, false, ['encrypt','decrypt']);
}

async function sealJson(value, secret) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await encryptionKey(secret);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, plaintext);
  return {
    payload_ciphertext:bytesToBase64Url(new Uint8Array(ciphertext)),
    payload_iv:bytesToBase64Url(iv)
  };
}

async function openJson(ciphertext, iv, secret) {
  const key = await encryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name:'AES-GCM', iv:base64UrlToBytes(iv) },
    key,
    base64UrlToBytes(ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function bridgeConfig(request, env) {
  const clientId = String(env?.CANVA_CLIENT_ID || '').trim();
  const clientSecret = String(env?.CANVA_CLIENT_SECRET || '').trim();
  const encryptionSecret = String(env?.CANVA_TOKEN_ENCRYPTION_KEY || '').trim();
  const configuredRedirect = String(env?.CANVA_REDIRECT_URI || '').trim();
  const redirectUri = configuredRedirect || new URL('/canva-oauth/callback', request.url).toString();
  const missing = [];
  if (!clientId) missing.push('CANVA_CLIENT_ID');
  if (!clientSecret) missing.push('CANVA_CLIENT_SECRET');
  if (!encryptionSecret) missing.push('CANVA_TOKEN_ENCRYPTION_KEY');
  if (!redirectUri.startsWith('https://')) missing.push('CANVA_REDIRECT_URI');
  return {
    configured:missing.length === 0,
    missing,
    clientId,
    clientSecret,
    encryptionSecret,
    redirectUri
  };
}

function safeErrorDetail(data) {
  return String(data?.message || data?.error_description || data?.error || '').slice(0,240);
}

async function tokenRequest(config, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('canva-token-timeout'), 15000);
  try {
    const credentials = btoa(`${config.clientId}:${config.clientSecret}`);
    const response = await fetch(CANVA_TOKEN_URL, {
      method:'POST',
      signal:controller.signal,
      headers:{
        authorization:`Basic ${credentials}`,
        'content-type':'application/x-www-form-urlencoded',
        accept:'application/json'
      },
      body:new URLSearchParams(params)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.access_token) {
      throw new CanvaBridgeError(
        safeErrorDetail(data) || `Canva recusou a troca de token (${response.status}).`,
        { status:502, code:'canva_token_exchange_failed' }
      );
    }
    return data;
  } catch (error) {
    if (error instanceof CanvaBridgeError) throw error;
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new CanvaBridgeError('Canva excedeu o tempo limite ao gerar o token.', {
        status:504,
        code:'canva_token_timeout'
      });
    }
    throw new CanvaBridgeError('Não foi possível conectar ao serviço de autenticação do Canva.', {
      status:502,
      code:'canva_token_transport_error'
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTokenPayload(token, previous = null) {
  const expiresIn = Math.max(60, Number(token?.expires_in || 0) || 14400);
  return {
    access_token:String(token.access_token || ''),
    refresh_token:String(token.refresh_token || previous?.refresh_token || ''),
    token_type:String(token.token_type || 'Bearer'),
    scope:String(token.scope || previous?.scope || CANVA_SCOPES.join(' ')),
    expires_at:new Date(Date.now() + expiresIn * 1000).toISOString()
  };
}

async function saveConnection(env, config, tokenPayload) {
  const sealed = await sealJson(tokenPayload, config.encryptionSecret);
  await supabaseRpc(env,'nisti_canva_connection_set_v1',{
    p_payload_ciphertext:sealed.payload_ciphertext,
    p_payload_iv:sealed.payload_iv
  });
}

async function loadConnection(env, config) {
  const row = await supabaseRpc(env,'nisti_canva_connection_get_v1',{});
  if (!row?.payload_ciphertext || !row?.payload_iv) return null;
  try {
    return await openJson(row.payload_ciphertext,row.payload_iv,config.encryptionSecret);
  } catch {
    throw new CanvaBridgeError(
      'A conexão do Canva não pôde ser descriptografada. Reconecte o Canva.',
      { status:409, code:'canva_connection_unreadable' }
    );
  }
}

async function refreshConnection(env, config, current) {
  if (!current?.refresh_token) {
    throw new CanvaBridgeError('A sessão do Canva expirou e não possui refresh token.', {
      status:401,
      code:'canva_refresh_token_missing'
    });
  }
  const refreshed = await tokenRequest(config,{
    grant_type:'refresh_token',
    refresh_token:current.refresh_token
  });
  const normalized = normalizeTokenPayload(refreshed,current);
  await saveConnection(env,config,normalized);
  return normalized;
}

async function accessToken(env, config) {
  let current = await loadConnection(env,config);
  if (!current?.access_token) return null;
  const expiresAt = Date.parse(current.expires_at || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + TOKEN_REFRESH_SKEW_MS) {
    current = await refreshConnection(env,config,current);
  }
  return current.access_token;
}

async function canvaGet(path, accessTokenValue) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('canva-api-timeout'), 12000);
  try {
    const response = await fetch(`${CANVA_API_URL}${path}`,{
      signal:controller.signal,
      headers:{
        authorization:`Bearer ${accessTokenValue}`,
        accept:'application/json'
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new CanvaBridgeError(
        safeErrorDetail(data) || `Canva respondeu com erro ${response.status}.`,
        { status:response.status === 401 ? 401 : 502, code:'canva_api_error' }
      );
    }
    return data;
  } catch (error) {
    if (error instanceof CanvaBridgeError) throw error;
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new CanvaBridgeError('Canva excedeu o tempo limite.', {
        status:504,
        code:'canva_api_timeout'
      });
    }
    throw new CanvaBridgeError('Não foi possível consultar o Canva.', {
      status:502,
      code:'canva_api_transport_error'
    });
  } finally {
    clearTimeout(timer);
  }
}

async function beginConnection(request, env) {
  const config = bridgeConfig(request,env);
  if (!config.configured) {
    return json({
      error:'Integração Canva ainda não configurada no Worker.',
      code:'canva_not_configured',
      missing:config.missing
    },503);
  }

  const state = randomToken(64);
  const verifier = randomToken(72);
  const challenge = await sha256Base64Url(verifier);
  const stateHash = await sha256Base64Url(state);
  const sealed = await sealJson({
    code_verifier:verifier,
    redirect_uri:config.redirectUri,
    created_at:new Date().toISOString()
  },config.encryptionSecret);

  await supabaseRpc(env,'nisti_canva_oauth_state_put_v1',{
    p_state_hash:stateHash,
    p_payload_ciphertext:sealed.payload_ciphertext,
    p_payload_iv:sealed.payload_iv,
    p_expires_at:new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()
  });

  const url = new URL(CANVA_AUTHORIZE_URL);
  url.searchParams.set('code_challenge',challenge);
  url.searchParams.set('code_challenge_method','S256');
  url.searchParams.set('scope',CANVA_SCOPES.join(' '));
  url.searchParams.set('response_type','code');
  url.searchParams.set('client_id',config.clientId);
  url.searchParams.set('state',state);
  url.searchParams.set('redirect_uri',config.redirectUri);

  return json({
    ok:true,
    authorization_url:url.toString(),
    redirect_uri:config.redirectUri,
    scopes:CANVA_SCOPES
  });
}

function adminRedirect(request, params) {
  const url = new URL('/admin',request.url);
  for (const [key,value] of Object.entries(params || {})) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key,String(value));
  }
  return Response.redirect(url.toString(),302);
}

async function finishConnection(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get('error')) {
    return adminRedirect(request,{ canva:'error', reason:'authorization_denied' });
  }
  const code = String(url.searchParams.get('code') || '').trim();
  const state = String(url.searchParams.get('state') || '').trim();
  if (!code || !state) return adminRedirect(request,{ canva:'error', reason:'callback_invalid' });

  const config = bridgeConfig(request,env);
  if (!config.configured) return adminRedirect(request,{ canva:'error', reason:'configuration_missing' });

  try {
    const stateHash = await sha256Base64Url(state);
    const stored = await supabaseRpc(env,'nisti_canva_oauth_state_take_v1',{
      p_state_hash:stateHash
    });
    if (!stored?.payload_ciphertext || !stored?.payload_iv) {
      return adminRedirect(request,{ canva:'error', reason:'state_invalid_or_expired' });
    }

    const payload = await openJson(
      stored.payload_ciphertext,
      stored.payload_iv,
      config.encryptionSecret
    );
    if (!payload?.code_verifier || payload.redirect_uri !== config.redirectUri) {
      return adminRedirect(request,{ canva:'error', reason:'state_mismatch' });
    }

    const token = await tokenRequest(config,{
      grant_type:'authorization_code',
      code_verifier:String(payload.code_verifier),
      code,
      redirect_uri:config.redirectUri
    });
    await saveConnection(env,config,normalizeTokenPayload(token));
    return adminRedirect(request,{ canva:'connected' });
  } catch (error) {
    console.error('[Canva OAuth] Falha no callback', {
      code:error?.code || 'canva_callback_error',
      status:Number(error?.status || 0) || null
    });
    return adminRedirect(request,{ canva:'error', reason:error?.code || 'callback_failed' });
  }
}

async function connectionStatus(request, env) {
  const config = bridgeConfig(request,env);
  if (!config.configured) {
    return json({
      ok:true,
      configured:false,
      connected:false,
      missing:config.missing,
      redirect_uri:config.redirectUri,
      required_scopes:CANVA_SCOPES
    });
  }

  let token;
  try {
    token = await accessToken(env,config);
  } catch (error) {
    return json({
      ok:true,
      configured:true,
      connected:false,
      reason:error?.code || 'canva_connection_invalid',
      redirect_uri:config.redirectUri,
      required_scopes:CANVA_SCOPES
    });
  }
  if (!token) {
    return json({
      ok:true,
      configured:true,
      connected:false,
      redirect_uri:config.redirectUri,
      required_scopes:CANVA_SCOPES
    });
  }

  try {
    const [capabilitiesResult,profileResult] = await Promise.all([
      canvaGet('/users/me/capabilities',token),
      canvaGet('/users/me/profile',token)
    ]);
    const capabilities = Array.isArray(capabilitiesResult?.capabilities)
      ? capabilitiesResult.capabilities
      : [];
    return json({
      ok:true,
      configured:true,
      connected:true,
      redirect_uri:config.redirectUri,
      required_scopes:CANVA_SCOPES,
      capabilities,
      background_removal:capabilities.includes('background_removal'),
      export_png_transparency:capabilities.includes('export_png_transparency'),
      profile:profileResult?.profile || null
    });
  } catch (error) {
    return json({
      ok:true,
      configured:true,
      connected:false,
      reason:error?.code || 'canva_status_failed',
      redirect_uri:config.redirectUri,
      required_scopes:CANVA_SCOPES
    });
  }
}

async function disconnect(env) {
  await supabaseRpc(env,'nisti_canva_connection_clear_v1',{});
  return json({ok:true,connected:false});
}

export async function handleCanvaImageBridgeRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/canva-oauth/callback' && request.method === 'GET') {
    return finishConnection(request,env);
  }
  if (url.pathname === '/api/admin/canva/status' && request.method === 'GET') {
    return connectionStatus(request,env);
  }
  if (url.pathname === '/api/admin/canva/connect' && request.method === 'POST') {
    return beginConnection(request,env);
  }
  if (url.pathname === '/api/admin/canva/disconnect' && request.method === 'POST') {
    return disconnect(env);
  }
  return null;
}
