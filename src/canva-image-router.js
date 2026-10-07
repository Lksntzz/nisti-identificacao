import { supabaseRpc } from './supabase-read-store.js';
import { canvaBackgroundRemoveToPng, canvaUploadAsset, safeCanvaDownloadUrl, CanvaCutoutError } from './canva-product-cutout.js';

const CANVA_AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize';
const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const CANVA_REVOKE_URL = 'https://api.canva.com/rest/v1/oauth/revoke';
const CANVA_API_URL = 'https://api.canva.com/rest/v1';
const CANVA_SCOPES = Object.freeze(['asset:read','asset:write','design:content:read','design:content:write','design:meta:read','brandtemplate:meta:read','brandtemplate:content:read','profile:read']);
const CANVA_ART_SCOPES = Object.freeze(['asset:read','asset:write','design:content:read','design:content:write','design:meta:read','brandtemplate:meta:read','brandtemplate:content:read']);
const CANVA_JOB_ATTEMPTS = 36;
const CANVA_JOB_DELAY_MS = 350;
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

async function activeConnection(env, config) {
  let current = await loadConnection(env,config);
  if (!current?.access_token) return null;
  const expiresAt = Date.parse(current.expires_at || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + TOKEN_REFRESH_SKEW_MS) {
    current = await refreshConnection(env,config,current);
  }
  return current;
}

async function accessToken(env, config) {
  const current = await activeConnection(env,config);
  return current?.access_token || null;
}

function scopeSet(connection) {
  return new Set(String(connection?.scope || '').split(/\s+/).map(value=>value.trim()).filter(Boolean));
}

function missingScopes(connection, required = CANVA_SCOPES) {
  const granted = scopeSet(connection);
  return required.filter(scope=>!granted.has(scope));
}

function sleep(ms) {
  return new Promise(resolve=>setTimeout(resolve,ms));
}

async function canvaJson(path, accessTokenValue, { method='GET', body, headers={} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('canva-api-timeout'), 15000);
  try {
    const response = await fetch(`${CANVA_API_URL}${path}`,{
      method,
      signal:controller.signal,
      headers:{
        authorization:`Bearer ${accessTokenValue}`,
        accept:'application/json',
        ...headers
      },
      body
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const upstreamCode=String(data?.code || data?.error?.code || 'canva_api_error').slice(0,120);
      const status=[400,401,403,404,409,429].includes(response.status) ? response.status : 502;
      throw new CanvaBridgeError(
        safeErrorDetail(data) || `Canva respondeu com erro ${response.status}.`,
        { status, code:upstreamCode || 'canva_api_error' }
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

async function canvaGet(path, accessTokenValue) {
  return canvaJson(path,accessTokenValue);
}

async function pollCanvaJob(path, token, label) {
  for (let attempt=0;attempt<CANVA_JOB_ATTEMPTS;attempt+=1) {
    const data=await canvaGet(path,token);
    const job=data?.job;
    if (job?.status==='success') return job;
    if (job?.status==='failed') {
      throw new CanvaBridgeError(
        String(job?.error?.message || `O Canva não concluiu ${label}.`).slice(0,300),
        { status:422, code:String(job?.error?.code || 'canva_job_failed') }
      );
    }
    await sleep(CANVA_JOB_DELAY_MS);
  }
  throw new CanvaBridgeError(`O Canva demorou demais para concluir ${label}.`,{
    status:504,
    code:'canva_job_timeout'
  });
}

function normalizeFieldName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'');
}

function textValueForField(fieldName, metadata) {
  const key=normalizeFieldName(fieldName);
  const candidates=[
    [['titulo','title','headline','nomeproduto','nomecolecao','nome'],metadata.title],
    [['subtitulo','subtitle','tagline','frase','frasecurta','apoio'],metadata.subtitle],
    [['descricao','description','body','mensagem','message','texto'],metadata.body],
    [['selo','badge','etiqueta','label'],metadata.badge],
    [['sku','codigo','codigoproduto'],metadata.sku],
    [['ano','year'],metadata.year],
    [['acao','cta','calltoaction'],metadata.cta],
    [['tipo','kind','categoria','category'],metadata.kind_label]
  ];
  for (const [aliases,value] of candidates) {
    if (value === null || value === undefined || String(value).trim()==='') continue;
    if (aliases.some(alias=>key===alias || key.includes(alias))) return String(value).slice(0,1000);
  }
  return '';
}

function imageIndexForField(fieldName, fallbackIndex) {
  const key=normalizeFieldName(fieldName);
  const match=key.match(/(?:produto|product|imagem|image|foto|photo|capa|cover)([1-9])/);
  if (match) return Math.max(0,Number(match[1])-1);
  if (/hero|principal|main|destaque|background|fundo/.test(key)) return 0;
  return fallbackIndex;
}

function validateArtworkFile(file) {
  if (!(file instanceof File)) return null;
  const allowed=new Set(['image/png','image/jpeg','image/webp']);
  if (!allowed.has(String(file.type||'').toLowerCase())) {
    throw new CanvaBridgeError('Use imagens PNG, JPEG ou WEBP na arte do Canva.',{
      status:400,code:'canva_art_image_type_invalid'
    });
  }
  if (file.size<1 || file.size>20*1024*1024) {
    throw new CanvaBridgeError('Cada imagem enviada ao Canva deve ter no máximo 20 MB.',{
      status:400,code:'canva_art_image_size_invalid'
    });
  }
  return file;
}

async function artworkConnection(request,env) {
  const config=bridgeConfig(request,env);
  if(!config.configured) throw new CanvaBridgeError('Integração Canva ainda não configurada no Worker.',{
    status:503,code:'canva_not_configured'
  });
  const connection=await activeConnection(env,config);
  if(!connection?.access_token) throw new CanvaBridgeError('Canva não está conectado ao Mural.',{
    status:401,code:'canva_not_connected'
  });
  const missing=missingScopes(connection,CANVA_ART_SCOPES);
  if(missing.length) throw new CanvaBridgeError('Reconecte o Canva para liberar a criação de artes no Mural.',{
    status:409,code:'canva_art_scopes_missing'
  });
  return {config,connection,token:connection.access_token};
}

async function listArtworkTemplates(request,env) {
  try{
    const {token}=await artworkConnection(request,env);
    const url=new URL(request.url);
    const query=String(url.searchParams.get('q')||'').trim().slice(0,80);
    const params=new URLSearchParams({
      dataset:'non_empty',
      limit:'50',
      ownership:'any',
      sort_by:query?'relevance':'modified_descending'
    });
    if(query)params.set('query',query);
    const data=await canvaGet(`/brand-templates?${params.toString()}`,token);
    const items=(Array.isArray(data?.items)?data.items:[]).map(item=>({
      id:String(item.id||''),
      title:String(item.title||'Template Canva'),
      thumbnail:item.thumbnail?.url||null,
      create_url:item.create_url||null,
      updated_at:item.updated_at||null
    })).filter(item=>item.id);
    return json({ok:true,items,continuation:data?.continuation||null});
  }catch(error){
    return json({
      error:String(error?.message||'Não foi possível carregar os templates do Canva.').slice(0,300),
      code:String(error?.code||'canva_templates_failed')
    },Number(error?.status||0)||502);
  }
}

async function createArtwork(request,env) {
  try{
    const {token}=await artworkConnection(request,env);
    const form=await request.formData();
    const templateId=String(form.get('template_id')||'').trim();
    if(!templateId)throw new CanvaBridgeError('Escolha um template do Canva.',{
      status:400,code:'canva_template_required'
    });
    let metadata={};
    try{metadata=JSON.parse(String(form.get('metadata')||'{}'))||{}}
    catch{throw new CanvaBridgeError('Os dados da publicação enviados ao Canva são inválidos.',{
      status:400,code:'canva_art_metadata_invalid'
    })}

    const datasetResult=await canvaGet(`/brand-templates/${encodeURIComponent(templateId)}/dataset`,token);
    const dataset=datasetResult?.dataset && typeof datasetResult.dataset==='object' ? datasetResult.dataset : {};
    const fields=Object.entries(dataset);
    if(!fields.length)throw new CanvaBridgeError('Este template não possui campos de preenchimento automático.',{
      status:422,code:'canva_template_dataset_empty'
    });

    const files=[];
    for(let index=0;index<6;index+=1){
      const key=index===0?'image':`image_${index+1}`;
      const file=validateArtworkFile(form.get(key));
      if(file)files.push(file);
    }

    const imageFieldCount=fields.filter(([,def])=>def?.type==='image').length;
    const uploadedAssets=[];
    if(imageFieldCount && files.length){
      const uploadCount=Math.min(files.length,imageFieldCount);
      for(let index=0;index<uploadCount;index+=1){
        const file=files[index];
        const asset=await canvaUploadAsset(
          await file.arrayBuffer(),
          token,
          `NISTI Mural ${String(metadata.kind_label||metadata.kind||'arte')} ${index+1}`
        );
        if(asset?.id)uploadedAssets.push(asset);
      }
    }

    const data={};
    let fallbackImageIndex=0;
    const filled=[];
    for(const [name,definition] of fields){
      if(definition?.type==='text'){
        const value=textValueForField(name,metadata);
        if(value){
          data[name]={type:'text',text:value};
          filled.push(name);
        }
        continue;
      }
      if(definition?.type==='image' && uploadedAssets.length){
        const preferred=imageIndexForField(name,fallbackImageIndex);
        const asset=uploadedAssets[Math.min(preferred,uploadedAssets.length-1)];
        if(asset?.id){
          data[name]={type:'image',asset_id:asset.id};
          filled.push(name);
          fallbackImageIndex=Math.min(fallbackImageIndex+1,uploadedAssets.length-1);
        }
      }
    }

    if(!Object.keys(data).length){
      throw new CanvaBridgeError('O template não possui campos compatíveis com os dados desta publicação.',{
        status:422,code:'canva_template_fields_unmatched'
      });
    }

    const title=String(
      metadata.design_title
      || `NISTI Mural · ${metadata.kind_label||'Publicação'} · ${metadata.title||new Date().toISOString().slice(0,10)}`
    ).slice(0,250);

    const started=await canvaJson('/autofills',token,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        type:'create_from_brand_template',
        brand_template_id:templateId,
        title,
        data
      })
    });
    let job=started?.job;
    if(!job?.id)throw new CanvaBridgeError('Canva não retornou o job de criação da arte.',{
      status:502,code:'canva_autofill_job_missing'
    });
    if(job.status!=='success'){
      job=await pollCanvaJob(`/autofills/${encodeURIComponent(job.id)}`,token,'a criação da arte');
    }
    const design=job?.result?.design;
    if(!design?.id)throw new CanvaBridgeError('Canva concluiu a criação sem retornar o design.',{
      status:502,code:'canva_autofill_design_missing'
    });
    return json({
      ok:true,
      design:{
        id:design.id,
        title:design.title||title,
        edit_url:design.urls?.edit_url||design.url||null,
        view_url:design.urls?.view_url||design.url||null,
        thumbnail:design.thumbnail?.url||null
      },
      template_id:templateId,
      filled_fields:filled,
      trial_information:job?.result?.trial_information||null
    });
  }catch(error){
    return json({
      error:String(error?.message||'Não foi possível criar a arte no Canva.').slice(0,300),
      code:String(error?.code||'canva_art_create_failed')
    },Number(error?.status||0)||502);
  }
}

async function exportArtwork(request,env) {
  try{
    const {token}=await artworkConnection(request,env);
    const payload=await request.json().catch(()=>({}));
    const designId=String(payload?.design_id||'').trim();
    if(!designId)throw new CanvaBridgeError('Design do Canva não informado.',{
      status:400,code:'canva_design_required'
    });
    const started=await canvaJson('/exports',token,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        design_id:designId,
        format:{type:'png',pages:[1],lossless:true,width:1600}
      })
    });
    let job=started?.job;
    if(!job?.id && job?.status!=='success')throw new CanvaBridgeError('Canva não retornou o job de exportação.',{
      status:502,code:'canva_export_job_missing'
    });
    if(job?.status!=='success'){
      job=await pollCanvaJob(`/exports/${encodeURIComponent(job.id)}`,token,'a exportação da arte');
    }
    const downloadUrl=safeCanvaDownloadUrl(Array.isArray(job?.urls)?job.urls[0]:'');
    if(!downloadUrl)throw new CanvaBridgeError('Canva retornou uma URL de exportação inválida ou não autorizada.',{
      status:502,code:'canva_export_url_invalid'
    });
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort('canva-art-download-timeout'),15000);
    try{
      const response=await fetch(downloadUrl,{signal:controller.signal});
      if(!response.ok)throw new CanvaBridgeError('Não foi possível baixar a arte final do Canva.',{
        status:502,code:'canva_art_download_failed'
      });
      const bytes=await response.arrayBuffer();
      const type=String(response.headers.get('content-type')||'').toLowerCase();
      if(!type.includes('image/png')||bytes.byteLength<1||bytes.byteLength>25*1024*1024){
        throw new CanvaBridgeError('O Canva não retornou um PNG válido para o Mural.',{
          status:502,code:'canva_art_png_invalid'
        });
      }
      return new Response(bytes,{
        status:200,
        headers:{
          'content-type':'image/png',
          'cache-control':'no-store',
          'x-nisti-canva-design-id':designId
        }
      });
    }finally{clearTimeout(timer)}
  }catch(error){
    return json({
      error:String(error?.message||'Não foi possível importar a arte do Canva.').slice(0,300),
      code:String(error?.code||'canva_art_export_failed')
    },Number(error?.status||0)||502);
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
      required_scopes:CANVA_SCOPES,
      art_creation_ready:false,
      art_missing_scopes:CANVA_ART_SCOPES
    });
  }

  let connection;
  try {
    connection = await activeConnection(env,config);
  } catch (error) {
    return json({
      ok:true,
      configured:true,
      connected:false,
      reason:error?.code || 'canva_connection_invalid',
      redirect_uri:config.redirectUri,
      required_scopes:CANVA_SCOPES,
      art_creation_ready:false,
      art_missing_scopes:CANVA_ART_SCOPES
    });
  }
  const token=connection?.access_token || '';
  if (!token) {
    return json({
      ok:true,
      configured:true,
      connected:false,
      redirect_uri:config.redirectUri,
      required_scopes:CANVA_SCOPES,
      art_creation_ready:false,
      art_missing_scopes:CANVA_ART_SCOPES
    });
  }

  const artMissing=missingScopes(connection,CANVA_ART_SCOPES);
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
      granted_scopes:[...scopeSet(connection)],
      art_creation_ready:artMissing.length===0,
      art_missing_scopes:artMissing,
      requires_reconnect:artMissing.length>0,
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
      required_scopes:CANVA_SCOPES,
      art_creation_ready:false,
      art_missing_scopes:artMissing
    });
  }
}

async function backgroundRemove(request, env) {
  const config=bridgeConfig(request,env);
  if(!config.configured){
    return json({
      error:'Integração Canva ainda não configurada no Worker.',
      code:'canva_not_configured',
      missing:config.missing
    },503);
  }

  try{
    const token=await accessToken(env,config);
    if(!token) return json({
      error:'Canva não está conectado ao Mural.',
      code:'canva_not_connected'
    },401);

    const capabilitiesResult=await canvaGet('/users/me/capabilities',token);
    const capabilities=Array.isArray(capabilitiesResult?.capabilities)
      ? capabilitiesResult.capabilities
      : [];
    if(!capabilities.includes('background_removal')){
      return json({
        error:'Esta conta Canva não possui remoção de fundo disponível.',
        code:'canva_background_removal_unavailable'
      },403);
    }
    if(!capabilities.includes('export_png_transparency')){
      return json({
        error:'Esta conta Canva não permite exportar PNG transparente.',
        code:'canva_transparent_export_unavailable'
      },403);
    }

    const form=await request.formData();
    const file=form.get('image');
    if(!(file instanceof File)) return json({error:'Imagem obrigatória.',code:'image_required'},400);
    const allowed=new Set(['image/png','image/jpeg','image/webp']);
    if(!allowed.has(String(file.type||'').toLowerCase())){
      return json({error:'Use uma imagem PNG, JPEG ou WEBP.',code:'image_type_invalid'},400);
    }
    if(file.size<1 || file.size>20*1024*1024){
      return json({error:'A imagem precisa ter no máximo 20 MB.',code:'image_size_invalid'},400);
    }

    const name=String(form.get('name')||file.name||'NISTI produto').trim().slice(0,40) || 'NISTI produto';
    const output=await canvaBackgroundRemoveToPng({
      bytes:await file.arrayBuffer(),
      token,
      name
    });
    return new Response(output,{
      status:200,
      headers:{
        'content-type':'image/png',
        'cache-control':'no-store',
        'x-nisti-image-processor':'canva-background-removal'
      }
    });
  }catch(error){
    const status=Number(error?.status||0) || 502;
    const code=String(error?.code||'canva_background_removal_failed');
    console.warn('[Canva imagem] Falha controlada', {status,code});
    return json({
      error:String(error?.message||'Falha no tratamento do Canva.').slice(0,300),
      code
    },status);
  }
}

async function revokeToken(config, token) {
  if (!token) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('canva-revoke-timeout'), 12000);
  try {
    const credentials = btoa(`${config.clientId}:${config.clientSecret}`);
    const response = await fetch(CANVA_REVOKE_URL,{
      method:'POST',
      signal:controller.signal,
      headers:{
        authorization:`Basic ${credentials}`,
        'content-type':'application/x-www-form-urlencoded',
        accept:'application/json'
      },
      body:new URLSearchParams({token})
    });
    if (!response.ok && response.status !== 400) {
      throw new CanvaBridgeError('Canva não confirmou a revogação da sessão.', {
        status:502,
        code:'canva_revoke_failed'
      });
    }
  } catch (error) {
    if (error instanceof CanvaBridgeError) throw error;
    throw new CanvaBridgeError('Não foi possível revogar a sessão no Canva.', {
      status:502,
      code:'canva_revoke_transport_error'
    });
  } finally {
    clearTimeout(timer);
  }
}

async function disconnect(request, env) {
  const config = bridgeConfig(request,env);
  if (!config.configured) {
    return json({
      error:'Integração Canva não está configurada para uma desconexão segura.',
      code:'canva_not_configured',
      missing:config.missing
    },503);
  }

  const current = await loadConnection(env,config);
  if (current) {
    await revokeToken(config,current.refresh_token || current.access_token);
  }
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
  if (url.pathname === '/api/admin/canva/background-remove' && request.method === 'POST') {
    return backgroundRemove(request,env);
  }
  if (url.pathname === '/api/admin/canva/templates' && request.method === 'GET') {
    return listArtworkTemplates(request,env);
  }
  if (url.pathname === '/api/admin/canva/art/create' && request.method === 'POST') {
    return createArtwork(request,env);
  }
  if (url.pathname === '/api/admin/canva/art/export' && request.method === 'POST') {
    return exportArtwork(request,env);
  }
  if (url.pathname === '/api/admin/canva/disconnect' && request.method === 'POST') {
    return disconnect(request,env);
  }
  return null;
}
