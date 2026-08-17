import app from './mercadolivre-puppeteer-router.js';

async function expectedVariationsFromCatalog(env, link) {
  if (!env.DB || !link) return [];
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT p.variacao
    FROM products p
    JOIN product_platforms pp ON pp.product_id = p.id
    WHERE pp.link = ?
      AND p.image_key IS NULL
      AND p.variacao IS NOT NULL
      AND TRIM(p.variacao) <> ''
    ORDER BY p.variacao
  `).bind(String(link).trim()).all();

  return (results || [])
    .map(row => String(row.variacao || '').trim())
    .filter(Boolean);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/mercadolivre-analyze' && request.method === 'POST') {
      try {
        const body = await request.clone().json();
        const supplied = Array.isArray(body?.expected_variations)
          ? body.expected_variations.map(value => String(value || '').trim()).filter(Boolean)
          : [];
        const expected = supplied.length
          ? supplied
          : await expectedVariationsFromCatalog(env, body?.url);

        const forwarded = new Request(request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify({ ...body, expected_variations: expected })
        });
        return app.fetch(forwarded, env, ctx);
      } catch {
        return app.fetch(request, env, ctx);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
