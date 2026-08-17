import { parseSku } from './sku.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'nisti-identificacao' });
    }

    if (url.pathname === '/api/sku/parse' && request.method === 'POST') {
      try {
        const { sku } = await request.json();
        return json(parseSku(sku));
      } catch (error) {
        return json({ error: error.message }, 400);
      }
    }

    if (url.pathname === '/api/products' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT id, sku, miolo_code, capa_code, acabamento_code, wireo_code, tassel_code, elastico_code, nome, variacao, image_key, created_at
         FROM products ORDER BY id DESC LIMIT 200`
      ).all();
      return json({ products: results });
    }

    if (url.pathname === '/api/products' && request.method === 'POST') {
      try {
        const body = await request.json();
        const parsed = parseSku(body.sku);
        const result = await env.DB.prepare(
          `INSERT INTO products (sku, miolo_code, capa_code, acabamento_code, wireo_code, tassel_code, elastico_code, nome, variacao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          parsed.sku, parsed.mioloCode, parsed.capaCode, parsed.acabamentoCode,
          parsed.wireoCode, parsed.tasselCode, parsed.elasticoCode,
          body.nome || null, body.variacao || null
        ).run();
        return json({ ok: true, id: result.meta.last_row_id, parsed }, 201);
      } catch (error) {
        return json({ error: error.message }, 400);
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};
