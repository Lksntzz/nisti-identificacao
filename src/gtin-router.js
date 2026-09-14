import app from './core-router.js';
import { parseSku } from './sku.js';
import { isValidGtin13, normalizeGtin } from './gtin.js';
import { normalizePlatform } from './platform-scope.js';
import { preferSupabaseRead, supabaseProductByGtin } from './supabase-read-store.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function productPayload(row) {
  if (!row) return null;
  const parsed = parseSku(row.sku);
  return {
    id: Number(row.id),
    sku: row.sku,
    nome: row.nome || '',
    capa_code: row.capa_code || parsed.capaCode,
    image_key: row.image_key || null,
    image_url: row.image_key ? `/api/images/${row.id}` : null,
    platform: row.platform,
    link: row.link || null,
    gtin: row.gtin,
    gtin_type: row.gtin_type || 'GTIN-13',
    identified_by: 'gtin-gs1-v1',
    confidence: 1,
    wireo: parsed.wireo,
    tassel: parsed.tassel,
    elastico: parsed.elastico
  };
}

async function d1ProductByGtin(env, gtin, platform) {
  return env.DB.prepare(`
    SELECT p.id, p.sku, p.nome, p.capa_code, p.image_key,
           pp.platform, pp.link, g.gtin, g.gtin_type
    FROM product_gtins g
    JOIN products p ON p.id = g.product_id
    JOIN product_platforms pp ON pp.product_id = p.id
    WHERE g.gtin = ? AND g.active = 1 AND UPPER(TRIM(pp.platform)) = ?
    LIMIT 1
  `).bind(gtin, platform).first();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/gtin/resolve' || request.method !== 'GET') {
      return app.fetch(request, env, ctx);
    }

    const gtin = normalizeGtin(url.searchParams.get('gtin'));
    const platform = normalizePlatform(url.searchParams.get('platform'));
    if (!isValidGtin13(gtin)) {
      return json({ ok: false, error: 'GTIN-13 inválido.' }, 400);
    }
    if (!platform) {
      return json({ ok: false, error: 'Selecione a plataforma.' }, 400);
    }

    try {
      const row = await preferSupabaseRead(
        env,
        () => supabaseProductByGtin(env, gtin, platform),
        () => d1ProductByGtin(env, gtin, platform),
        `GTIN ${gtin}`
      );
      if (!row) return json({ ok: false, error: 'GTIN não vinculado a um produto desta plataforma.' }, 404);
      return json({ ok: true, gtin, platform, identified_by: 'gtin-gs1-v1', product: productPayload(row) });
    } catch (error) {
      return json({ ok: false, error: error?.message || 'Falha ao consultar GTIN.' }, 500);
    }
  }
};
