import app from './reference-reindex-router.js';
import { WIREO_COLORS, ACCESSORY_COLORS } from './sku.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function code(value) {
  return String(value || '').trim().toUpperCase();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/products\/(\d+)\/finish$/);

    if (match && request.method === 'PATCH') {
      try {
        const id = Number(match[1]);
        const body = await request.json().catch(() => ({}));
        const wireoCode = code(body.wireo_code);
        const tasselCode = code(body.tassel_code);
        const elasticoCode = code(body.elastico_code);

        if (!WIREO_COLORS[wireoCode]) {
          return json({ error: 'Wire-O inválido.' }, 400);
        }
        if (tasselCode !== 'X' && !ACCESSORY_COLORS[tasselCode]) {
          return json({ error: 'Tassel inválido.' }, 400);
        }
        if (!ACCESSORY_COLORS[elasticoCode]) {
          return json({ error: 'Elástico inválido.' }, 400);
        }

        const product = await env.DB.prepare(`
          SELECT id,sku,miolo_code,capa_code,image_key
          FROM products WHERE id=? LIMIT 1
        `).bind(id).first();

        if (!product) return json({ error: 'Produto não encontrado.' }, 404);

        const acabamentoCode = `${wireoCode}${tasselCode}${elasticoCode}`;
        const newSku = `${product.miolo_code}_${product.capa_code}_${acabamentoCode}`;

        const conflict = await env.DB.prepare(
          `SELECT id FROM products WHERE sku=? AND id<>? LIMIT 1`
        ).bind(newSku, id).first();

        if (conflict) {
          return json({ error: `Já existe outro produto com o SKU ${newSku}.` }, 409);
        }

        await env.DB.prepare(`
          UPDATE products SET
            sku=?,
            acabamento_code=?,
            wireo_code=?,
            tassel_code=?,
            elastico_code=?,
            updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).bind(
          newSku,
          acabamentoCode,
          wireoCode,
          tasselCode,
          elasticoCode,
          id
        ).run();

        return json({
          ok: true,
          product: {
            id,
            old_sku: product.sku,
            sku: newSku,
            acabamento_code: acabamentoCode,
            wireo_code: wireoCode,
            tassel_code: tasselCode,
            elastico_code: elasticoCode,
            wireo: WIREO_COLORS[wireoCode],
            tassel: tasselCode === 'X' ? 'Sem tassel' : ACCESSORY_COLORS[tasselCode],
            elastico: ACCESSORY_COLORS[elasticoCode]
          }
        });
      } catch (error) {
        const message = error?.message || 'Falha ao salvar acabamento.';
        const status = /UNIQUE constraint/i.test(message) ? 409 : 500;
        return json({ error: message }, status);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
