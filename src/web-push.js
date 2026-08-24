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
  if (!env?.DB || !subscription?.endpoint) return false;
  const endpoint = String(subscription.endpoint).trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);

  if (!endpoint || !p256dh || !auth) return false;

  await env.DB.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id=excluded.user_id,
      p256dh=excluded.p256dh,
      auth=excluded.auth,
      updated_at=CURRENT_TIMESTAMP
  `).bind(safeUserId, endpoint, p256dh, auth).run();

  return true;
}

export async function removePushSubscription(env, endpoint) {
  if (!env?.DB || !endpoint) return false;
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?')
    .bind(String(endpoint).trim()).run();
  return true;
}

export async function sendWebPushNotification(env, subscription, payload) {
  if (!subscription?.endpoint || !subscription?.p256dh || !subscription?.auth) {
    return { ok: false, status: 400 };
  }

  const endpoint = subscription.endpoint;
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

export async function broadcastNewCoverPush(env, {
  capaCode,
  productName = null,
  variacao = null,
  platform = null,
  imageUrl = null
}) {
  if (!env?.DB || !getVapidPrivateKey(env)) return;

  const { results } = await env.DB.prepare(`
    SELECT id, endpoint, p256dh, auth
    FROM push_subscriptions
  `).all();

  const subscriptions = results || [];
  if (!subscriptions.length) return;

  const payload = {
    title: '🔔 Nova Capa Cadastrada · NISTI PRINT',
    body: `${productName || 'Novo Produto'} (${capaCode})${platform ? ` · ${platform}` : ''}${variacao ? ` - ${variacao}` : ''}`,
    image_url: imageUrl || undefined,
    capa_code: capaCode,
    platform: platform || undefined,
    url: '/'
  };

  const deadEndpoints = [];

  await Promise.all(
    subscriptions.map(async sub => {
      try {
        console.log(`[Push] Iniciando envio para sub ${sub.id}: ${sub.endpoint.slice(0, 40)}...`);
        const res = await sendWebPushNotification(env, sub, payload);
        console.log(`[Push] Retorno da sub ${sub.id}: status=${res.status}, ok=${res.ok}`);
        if (res.status === 404 || res.status === 410) {
          deadEndpoints.push(sub.endpoint);
        }
      } catch (err) {
        console.error(`[Push] Erro catastrófico na sub ${sub.id}:`, err.message);
      }
    })
  );

  if (deadEndpoints.length > 0) {
    for (const ep of deadEndpoints) {
      await removePushSubscription(env, ep).catch(() => {});
    }
  }
}
