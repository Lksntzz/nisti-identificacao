import {
  preferSupabaseRead,
  supabaseImageKey
} from './supabase-read-store.js';

const PRODUCT_IMAGE_PROCESSOR_VERSION = '12';

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
  if (entity === 'product-display') {
    const row = await env.DB.prepare(`
      SELECT
        p.image_key,
        mpi.source_image_key,
        mpi.processed_image_key,
        mpi.status,
        mpi.processor,
        mpi.processor_version,
        mpi.reviewed_by
      FROM products p
      LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
      WHERE p.id=?
      LIMIT 1
    `).bind(id).first();
    if (!row?.image_key) return null;
    const processedReady = row.status === 'approved'
      && row.processed_image_key
      && row.source_image_key === row.image_key
      && row.reviewed_by === 'admin';
    return processedReady ? row.processed_image_key : row.image_key;
  }
  if (entity === 'mural-product') {
    const row = await env.DB.prepare(`
      SELECT mpi.processed_image_key
      FROM mural_product_images mpi
      INNER JOIN products p ON p.id=mpi.product_id
      WHERE mpi.product_id=?
        AND mpi.status='approved'
        AND mpi.processed_image_key IS NOT NULL
        AND mpi.source_image_key=p.image_key
        AND mpi.reviewed_by='admin'
      LIMIT 1
    `).bind(id).first();
    return row?.processed_image_key || null;
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

async function serveObject(request, env, objectKey, url, extraHeaders = null) {
  if (!objectKey) return notFound();

  const object = request.method === 'HEAD'
    ? await env.PRODUCT_IMAGES.head(objectKey)
    : await env.PRODUCT_IMAGES.get(objectKey);

  if (!object) return notFound();
  const headers = responseHeaders(object, url);
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      if (value !== undefined && value !== null) headers.set(name, String(value));
    }
  }

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

  const productDisplayMatch = url.pathname.match(/^\/api\/product-images\/(\d+)$/);
  if (productDisplayMatch) {
    const productId = Number(productDisplayMatch[1]);
    const processedKey = await imageKey(env, 'mural-product', productId);
    if (processedKey) {
      const processed = await serveObject(request, env, processedKey, url, {
        'x-nisti-image-source':'treated'
      });
      if (processed.status !== 404) return processed;
    }
    const originalKey = await imageKey(env, 'product', productId);
    return serveObject(request, env, originalKey, url, {
      'x-nisti-image-source':'original'
    });
  }

  const muralProductMatch = url.pathname.match(/^\/api\/mural-product-images\/(\d+)$/);
  if (muralProductMatch) {
    const objectKey = await imageKey(env, 'mural-product', Number(muralProductMatch[1]));
    return serveObject(request, env, objectKey, url);
  }

  return null;
}
