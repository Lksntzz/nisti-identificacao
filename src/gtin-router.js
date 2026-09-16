import app from './product-finish-router.js';
import { normalizeGtin, requireValidGtin13 } from './gtin.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function normalizeSource(value) {
  const source = String(value || 'GS1').trim().toUpperCase();
  return source || 'GS1';
}

async function productExists(env, productId) {
  return env.DB.prepare('SELECT id FROM products WHERE id=? LIMIT 1')
    .bind(productId)
    .first();
}

async function listProductGtins(env, productId) {
  const { results } = await env.DB.prepare(`
    SELECT id,product_id,gtin,gtin_type,source,active,created_at,updated_at
    FROM product_gtins
    WHERE product_id=?
    ORDER BY active DESC,id ASC
  `).bind(productId).all();

  return (results || []).map(row => ({
    ...row,
    id: Number(row.id),
    product_id: Number(row.product_id),
    active: Number(row.active) === 1
  }));
}

async function lookupProductByGtin(env, gtin) {
  const row = await env.DB.prepare(`
    SELECT
      g.gtin,g.gtin_type,g.source,
      p.id,p.sku,p.miolo_code,p.capa_code,p.acabamento_code,
      p.wireo_code,p.tassel_code,p.elastico_code,
      p.nome,p.variacao,p.image_key
    FROM product_gtins g
    INNER JOIN products p ON p.id=g.product_id
    WHERE g.gtin=? AND g.active=1
    LIMIT 1
  `).bind(gtin).first();

  if (!row) return null;

  const { results: platformRows } = await env.DB.prepare(`
    SELECT platform,link
    FROM product_platforms
    WHERE product_id=?
    ORDER BY id ASC
  `).bind(row.id).all();

  return {
    gtin: row.gtin,
    gtin_type: row.gtin_type,
    source: row.source,
    product: {
      id: Number(row.id),
      sku: row.sku,
      miolo_code: row.miolo_code,
      capa_code: row.capa_code,
      acabamento_code: row.acabamento_code,
      wireo_code: row.wireo_code,
      tassel_code: row.tassel_code,
      elastico_code: row.elastico_code,
      nome: row.nome,
      variacao: row.variacao,
      image_key: row.image_key,
      image_url: row.image_key ? `/api/images/${Number(row.id)}` : null,
      platforms: (platformRows || []).map(item => ({
        platform: item.platform,
        link: item.link || null
      }))
    }
  };
}

async function bindGtinToProduct(env, productId, gtin, source) {
  const product = await productExists(env, productId);
  if (!product) {
    const error = new Error('Produto não encontrado.');
    error.code = 'product_not_found';
    error.status = 404;
    throw error;
  }

  const existing = await env.DB.prepare(`
    SELECT id,product_id,active
    FROM product_gtins
    WHERE gtin=?
    LIMIT 1
  `).bind(gtin).first();

  if (existing && Number(existing.active) === 1 && Number(existing.product_id) !== productId) {
    const error = new Error('Este GTIN já está vinculado a outro produto.');
    error.code = 'gtin_conflict';
    error.status = 409;
    error.productId = Number(existing.product_id);
    throw error;
  }

  if (existing) {
    await env.DB.prepare(`
      UPDATE product_gtins
      SET product_id=?,gtin_type='GTIN-13',source=?,active=1,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(productId, source, existing.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO product_gtins (product_id,gtin,gtin_type,source,active)
      VALUES (?,?,'GTIN-13',?,1)
    `).bind(productId, gtin, source).run();
  }

  return env.DB.prepare(`
    SELECT id,product_id,gtin,gtin_type,source,active,created_at,updated_at
    FROM product_gtins
    WHERE gtin=?
    LIMIT 1
  `).bind(gtin).first();
}

async function deactivateProductGtin(env, productId, gtin) {
  const existing = await env.DB.prepare(`
    SELECT id,product_id,active
    FROM product_gtins
    WHERE gtin=?
    LIMIT 1
  `).bind(gtin).first();

  if (!existing || Number(existing.product_id) !== productId) return false;

  await env.DB.prepare(`
    UPDATE product_gtins
    SET active=0,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(existing.id).run();
  return true;
}

function errorResponse(error) {
  const status = Number(error?.status || 500);
  const payload = {
    error: error?.message || 'Falha ao processar GTIN.',
    technical_error: error?.code || 'gtin_error'
  };
  if (error?.productId) payload.conflicting_product_id = Number(error.productId);
  return json(payload, status);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const publicLookup = pathname.match(/^\/api\/gtin\/([^/]+)$/);
    if (publicLookup && request.method === 'GET') {
      try {
        const gtin = requireValidGtin13(decodeURIComponent(publicLookup[1]));
        const result = await lookupProductByGtin(env, gtin);
        if (!result) {
          return json({
            error: 'GTIN não cadastrado.',
            technical_error: 'gtin_not_found',
            gtin
          }, 404);
        }
        return json({ ok: true, ...result });
      } catch (error) {
        return errorResponse(error);
      }
    }

    const productGtins = pathname.match(/^\/api\/products\/(\d+)\/gtins$/);
    if (productGtins && request.method === 'GET') {
      try {
        const productId = Number(productGtins[1]);
        const product = await productExists(env, productId);
        if (!product) return json({ error: 'Produto não encontrado.', technical_error: 'product_not_found' }, 404);
        return json({ ok: true, product_id: productId, gtins: await listProductGtins(env, productId) });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (productGtins && request.method === 'POST') {
      try {
        const productId = Number(productGtins[1]);
        const body = await request.json().catch(() => ({}));
        const gtin = requireValidGtin13(body?.gtin);
        const source = normalizeSource(body?.source);
        const row = await bindGtinToProduct(env, productId, gtin, source);
        return json({
          ok: true,
          gtin: {
            ...row,
            id: Number(row.id),
            product_id: Number(row.product_id),
            active: Number(row.active) === 1
          }
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    const productGtin = pathname.match(/^\/api\/products\/(\d+)\/gtins\/([^/]+)$/);
    if (productGtin && request.method === 'DELETE') {
      try {
        const productId = Number(productGtin[1]);
        const gtin = requireValidGtin13(decodeURIComponent(productGtin[2]));
        const removed = await deactivateProductGtin(env, productId, gtin);
        if (!removed) {
          return json({
            error: 'GTIN não encontrado para este produto.',
            technical_error: 'gtin_not_found',
            gtin
          }, 404);
        }
        return json({ ok: true, gtin, product_id: productId, active: false });
      } catch (error) {
        return errorResponse(error);
      }
    }

    return app.fetch(request, env, ctx);
  }
};

export {
  lookupProductByGtin,
  bindGtinToProduct,
  deactivateProductGtin,
  listProductGtins
};
