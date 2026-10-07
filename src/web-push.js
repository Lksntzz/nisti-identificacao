import { supabaseRpc } from './supabase-read-store.js';
import { mirrorSupabaseRpc } from './supabase-write-store.js';

const DEFAULT_VAPID_PUBLIC = 'BMGQFguG_CSRv9PiIgqRweD8o9cHv0LzzU9lZFwZLQv_Rmcn-xweIt0lCQwXVYgII2tyA68bBLskNe6s7XJ-oBc';
const DEFAULT_VAPID_SUBJECT = 'mailto:contato@nistiprint.com.br';

function b64url(buf) {
  let binary = '';
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(str) {
  const pad = str.padEnd(str.length + (4 - str.length % 4) % 4, '=');
  const binary = atob(pad.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function getVapidPublicKey(env) {
  return env?.VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC;
}

function getVapidPrivateKey(env) {
  return env?.VAPID_PRIVATE_KEY || '';
}

function getVapidSubject(env) {
  return env?.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT;
}

function isPrivateIpv4(hostname) {
  const match=String(hostname||'').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if(!match)return false;
  const octets=match.slice(1).map(Number);
  if(octets.some(value=>value<0||value>255))return true;
  const [a,b]=octets;
  return a===10
    || a===127
    || a===0
    || (a===169&&b===254)
    || (a===172&&b>=16&&b<=31)
    || (a===192&&b===168);
}

export function safePushEndpoint(value) {
  const raw=String(value||'').trim();
  if(!raw||raw.length>2048)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:')return null;
    const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
    if(!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal'))return null;
    if(host==='::1'||host.startsWith('fe80:')||host.startsWith('fc')||host.startsWith('fd')||isPrivateIpv4(host))return null;
    if(url.username||url.password)return null;
    return url.toString();
  }catch{
    return null;
  }
}

function validPushKey(value,{min=16,max=256}={}) {
  const clean=String(value||'').trim();
  return clean.length>=min&&clean.length<=max&&/^[A-Za-z0-9_-]+$/.test(clean);
}

async function createVapidJwt(env, endpoint) {
  const publicKeyStr = getVapidPublicKey(env);
  const privateKeyStr = getVapidPrivateKey(env);
  if (!privateKeyStr) {
    throw new Error('VAPID_PRIVATE_KEY não configurada');
  }
  const subject = getVapidSubject(env);

  const rawPub = fromB64url(publicKeyStr);
  const rawPriv = fromB64url(privateKeyStr);
  const x = rawPub.slice(1, 33);
  const y = rawPub.slice(33, 65);

  const privKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(x),
      y: b64url(y),
      d: b64url(rawPriv),
      ext: true
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const origin = new URL(endpoint).origin;
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 86400,
    sub: subject
  })));

  const unsigned = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privKey,
    new TextEncoder().encode(unsigned)
  );

  return `${unsigned}.${b64url(sig)}`;
}

async function encryptPushPayload(clientP256dh, clientAuth, payloadText) {
  const userPubBytes = fromB64url(clientP256dh);
  const userAuthBytes = fromB64url(clientAuth);

  const userKey = await crypto.subtle.importKey(
    'raw',
    userPubBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );

  const localKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: userKey },
    localKeys.privateKey,
    256
  );

  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeys.publicKey));

  const ikmKey = await crypto.subtle.importKey(
    'raw',
    sharedSecretBits,
    'HKDF',
    false,
    ['deriveBits']
  );

  const authInfo = new Uint8Array([
    ...new TextEncoder().encode('WebPush: info\0'),
    ...userPubBytes,
    ...localPubRaw
  ]);

  const prkBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: userAuthBytes, info: authInfo },
    ikmKey,
    256
  );

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const prkKey = await crypto.subtle.importKey(
    'raw',
    prkBits,
    'HKDF',
    false,
    ['deriveKey', 'deriveBits']
  );

  const cekKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: aes128gcm\0') },
    prkKey,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt']
  );

  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: nonce\0') },
    prkKey,
    96
  );

  const payloadBytes = new TextEncoder().encode(payloadText);
  const padded = new Uint8Array(payloadBytes.length + 1);
  padded.set(payloadBytes, 0);
  padded[payloadBytes.length] = 0x02;

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(nonceBits), tagLength: 128 },
    cekKey,
    padded
  );

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  header[16] = 0; header[17] = 0; header[18] = 0x10; header[19] = 0x00;
  header[20] = 65;
  header.set(localPubRaw, 21);

  const fullBody = new Uint8Array(header.length + cipherBuffer.byteLength);
  fullBody.set(header, 0);
  fullBody.set(new Uint8Array(cipherBuffer), header.length);

  return fullBody;
}

export async function savePushSubscription(env, userId, subscription) {
  if (!subscription?.endpoint) return false;
  const endpoint = safePushEndpoint(subscription.endpoint);
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);

  if (!endpoint || !validPushKey(p256dh,{min:40,max:200}) || !validPushKey(auth,{min:16,max:100})) return false;

  const result = await mirrorSupabaseRpc(env,'nisti_upsert_push_subscription_v1',{
    p_user_id:safeUserId,
    p_endpoint:endpoint,
    p_p256dh:p256dh,
    p_auth:auth
  },'push subscription primary');
  return result?.value?.status === 'ok';
}

export async function removePushSubscription(env, endpoint) {
  const cleanEndpoint = safePushEndpoint(endpoint);
  if (!cleanEndpoint) return false;
  await mirrorSupabaseRpc(env,'nisti_delete_push_subscription',{
    p_endpoint:cleanEndpoint
  },'delete push subscription primary');
  return true;
}

export async function sendWebPushNotification(env, subscription, payload) {
  if (!subscription?.endpoint || !subscription?.p256dh || !subscription?.auth) {
    return { ok: false, status: 400 };
  }

  const endpoint = safePushEndpoint(subscription.endpoint);
  if(!endpoint || !validPushKey(subscription.p256dh,{min:40,max:200}) || !validPushKey(subscription.auth,{min:16,max:100})) {
    return {ok:false,status:400};
  }
  const jwt = await createVapidJwt(env, endpoint);
  const publicKey = getVapidPublicKey(env);

  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const encryptedBytes = await encryptPushPayload(subscription.p256dh, subscription.auth, payloadString);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt},k=${publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'high'
    },
    body: encryptedBytes
  });

  return {
    ok: response.ok,
    status: response.status
  };
}

async function loadPushSubscriptions(env) {
  const rows = await supabaseRpc(env,'nisti_list_push_subscriptions_v1',{});
  return Array.isArray(rows) ? rows : [];
}

export async function broadcastNewCoverPush(env, {
  capaCode,
  productName = null,
  variacao = null,
  platform = null,
  imageUrl = null
}) {
  const privateKey = getVapidPrivateKey(env);
  if (!privateKey) return;

  const subscriptions = await loadPushSubscriptions(env);
  if (!subscriptions.length) return;

  const payload = {
    title:'Nova Capa Cadastrada · NISTI PRINT',
    body:`${productName || 'Novo Produto'} (${capaCode})${platform ? ` · ${platform}` : ''}${variacao ? ` - ${variacao}` : ''}`,
    image_url:imageUrl ? (imageUrl.startsWith('http') ? imageUrl : `https://nisti-identificacao.lksntz1411.workers.dev${imageUrl}`) : undefined,
    capa_code:capaCode,
    platform:platform || undefined,
    url:'/'
  };

  const deadEndpoints = [];

  await Promise.all(subscriptions.map(async sub => {
    try {
      console.log(`[Push] Iniciando envio para sub ${sub.id}: ${sub.endpoint.slice(0, 40)}...`);
      const res = await sendWebPushNotification(env, sub, payload);
      console.log(`[Push] Retorno da sub ${sub.id}: status=${res.status}, ok=${res.ok}`);
      if (res.status === 404 || res.status === 410) deadEndpoints.push(sub.endpoint);
    } catch (err) {
      console.error(`[Push] Erro catastrófico na sub ${sub.id}:`, err.message);
    }
  }));

  for (const endpoint of deadEndpoints) {
    await removePushSubscription(env, endpoint).catch(() => {});
  }
}

export async function broadcastMuralPush(env,{postId,title,body}) {
  const privateKey=getVapidPrivateKey(env);
  if(!privateKey) return {sent:0,failed:0,skipped:true};
  const subscriptions=await loadPushSubscriptions(env);
  let sent=0;let failed=0;const dead=[];
  const payload={title:String(title||'Mural NISTI').slice(0,90),body:String(body||'Nova publicação no Mural NISTI').slice(0,180),url:'/?view=mural',mural_post_id:Number(postId)};
  await Promise.all(subscriptions.map(async sub=>{try{const res=await sendWebPushNotification(env,sub,payload);if(res.ok)sent+=1;else failed+=1;if(res.status===404||res.status===410)dead.push(sub.endpoint)}catch(error){failed+=1;console.error('[Push Mural] Falha de envio',{postId:Number(postId),subscriptionId:sub.id,message:error?.message||String(error)})}}));
  for(const endpoint of dead) await removePushSubscription(env,endpoint).catch(()=>{});
  return {sent,failed,skipped:false};
}
