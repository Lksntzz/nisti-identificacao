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

async function productImageKey(env, id) {
  const row = await env.DB.prepare(
    'SELECT image_key FROM products WHERE id=? LIMIT 1'
  ).bind(id).first();
  return row?.image_key || null;
}

async function referenceImageKey(env, id) {
  const row = await env.DB.prepare(`
    SELECT image_key
    FROM cover_visual_references
    WHERE id=? AND active=1
    LIMIT 1
  `).bind(id).first();
  return row?.image_key || null;
}

async function serveObject(request, env, imageKey, url) {
  if (!imageKey) return notFound();

  const object = request.method === 'HEAD'
    ? await env.PRODUCT_IMAGES.head(imageKey)
    : await env.PRODUCT_IMAGES.get(imageKey);

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
    const imageKey = await productImageKey(env, Number(productMatch[1]));
    return serveObject(request, env, imageKey, url);
  }

  const referenceMatch = url.pathname.match(/^\/api\/reference-images\/(\d+)$/);
  if (referenceMatch) {
    const imageKey = await referenceImageKey(env, Number(referenceMatch[1]));
    return serveObject(request, env, imageKey, url);
  }

  const occurrenceMatch = url.pathname.match(/^\/api\/occurrence-images\/(\d+)$/);
  if (occurrenceMatch) {
    const row = await env.DB.prepare(
      'SELECT image_key FROM scan_occurrences WHERE id=? LIMIT 1'
    ).bind(Number(occurrenceMatch[1])).first();
    return serveObject(request, env, row?.image_key, url);
  }

  return null;
}
