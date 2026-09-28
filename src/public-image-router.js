import {
  preferSupabaseRead,
  supabaseImageKey
} from './supabase-read-store.js';

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'no-store' }
  });
}

function responseHeaders(object, url) {
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);

  if (!headers.get('content-type')) {
    headers.set('content-type', 'image/jpeg');
  }
  if (object.httpEtag) {
    headers.set('etag', object.httpEtag);
  }
  if (Number(object.size || 0) > 0) {
    headers.set('content-length', String(object.size));
  }

  headers.set(
    'cache-control',
    url.searchParams.has('v')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300'
  );

  // These endpoints are intentionally public: the operator UI displays them
  // and Gemini may fetch candidate images by HTTPS URL during verification.
  headers.set('access-control-allow-origin', '*');
  headers.set('cross-origin-resource-policy', 'cross-origin');
  headers.set('x-content-type-options', 'nosniff');
  return headers;
}

async function imageKeyFromD1(env, entity, id) {
  if (entity === 'product') {
    const row = await env.DB.prepare(
      'SELECT image_key FROM products WHERE id=? LIMIT 1'
    ).bind(id).first();
    return row?.image_key || null;
  }
  if (entity === 'reference') {
    const row = await env.DB.prepare(`
      SELECT image_key
      FROM cover_visual_references
      WHERE id=? AND active=1
      LIMIT 1
    `).bind(id).first();
    return row?.image_key || null;
  }
  if (entity === 'occurrence') {
    const row = await env.DB.prepare(
      'SELECT image_key FROM scan_occurrences WHERE id=? LIMIT 1'
    ).bind(id).first();
    return row?.image_key || null;
  }
  return null;
}

async function imageKey(env, entity, id) {
  return preferSupabaseRead(
    env,
    () => supabaseImageKey(env, entity, id),
    () => imageKeyFromD1(env, entity, id),
    `image-key:${entity}`
  );
}

async function serveObject(request, env, objectKey, url) {
  if (!objectKey) return notFound();

  const object = request.method === 'HEAD'
    ? await env.PRODUCT_IMAGES.head(objectKey)
    : await env.PRODUCT_IMAGES.get(objectKey);

  if (!object) return notFound();
  const headers = responseHeaders(object, url);

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

export async function handlePublicImageRequest(request, env) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;

  const url = new URL(request.url);
  const productMatch = url.pathname.match(/^\/api\/images\/(\d+)$/);
  if (productMatch) {
    const objectKey = await imageKey(env, 'product', Number(productMatch[1]));
    return serveObject(request, env, objectKey, url);
  }

  const referenceMatch = url.pathname.match(/^\/api\/reference-images\/(\d+)$/);
  if (referenceMatch) {
    const objectKey = await imageKey(env, 'reference', Number(referenceMatch[1]));
    return serveObject(request, env, objectKey, url);
  }

  const occurrenceMatch = url.pathname.match(/^\/api\/occurrence-images\/(\d+)$/);
  if (occurrenceMatch) {
    const objectKey = await imageKey(env, 'occurrence', Number(occurrenceMatch[1]));
    return serveObject(request, env, objectKey, url);
  }

  return null;
}
