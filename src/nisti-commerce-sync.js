import { supabaseRpc } from './supabase-read-store.js';

function isPreview(env) {
  return String(env?.COMMERCE_DATA_SCOPE || '').trim().toLowerCase() === 'preview';
}

function imageUrl(product) {
  if (!product?.image_key || !product?.id) return null;
  const version = String(product.image_key).split('/').pop() || 'current';
  return `/api/images/${Number(product.id)}?v=${encodeURIComponent(version)}`;
}

function normalizeRow(row) {
  return {
    id: Number(row.id),
    sku: String(row.sku || '').trim(),
    nome: row.nome || null,
    variacao: row.variacao || null,
    image_url: imageUrl(row),
    miolo_code: row.miolo_code || null,
    capa_code: row.capa_code || null,
    acabamento_code: row.acabamento_code || null,
    wireo_code: row.wireo_code || null,
    tassel_code: row.tassel_code || null,
    elastico_code: row.elastico_code || null,
    platform: row.platform || null,
    link: row.link || null,
    gtin: row.gtin || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function loadNistiProducts(env, ids = null) {
  const idList = Array.isArray(ids)
    ? [...new Set(ids.map(value => Number(value || 0)).filter(value => Number.isInteger(value) && value > 0))]
    : [];

  let sql = `
    SELECT
      p.id,p.sku,p.miolo_code,p.capa_code,p.acabamento_code,p.wireo_code,
      p.tassel_code,p.elastico_code,p.nome,p.variacao,p.image_key,p.created_at,p.updated_at,
      (SELECT pp.platform FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform,
      (SELECT pp.link FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS link,
      (SELECT pg.gtin FROM product_gtins pg WHERE pg.product_id=p.id AND pg.active=1 ORDER BY pg.id ASC LIMIT 1) AS gtin
    FROM products p
  `;

  let statement;
  if (idList.length) {
    const placeholders = idList.map(() => '?').join(',');
    sql += ` WHERE p.id IN (${placeholders})`;
    statement = env.DB.prepare(sql).bind(...idList);
  } else {
    statement = env.DB.prepare(sql);
  }

  sql += ' ORDER BY p.id ASC';

  if (idList.length) {
    statement = env.DB.prepare(sql).bind(...idList);
  } else {
    statement = env.DB.prepare(sql);
  }

  const { results } = await statement.all();
  return (results || []).map(normalizeRow);
}

async function syncBatch(env, products) {
  if (!products.length) {
    return { total: 0, created: 0, linked: 0, updated: 0, conflicts: 0, results: [] };
  }

  const result = await supabaseRpc(env, 'commerce_sync_nisti_products_v1', {
    p_products: products
  });

  return result && typeof result === 'object'
    ? result
    : { total: products.length, created: 0, linked: 0, updated: 0, conflicts: 0, results: [] };
}

function mergeSummary(target, part) {
  target.total += Number(part?.total || 0);
  target.created += Number(part?.created || 0);
  target.linked += Number(part?.linked || 0);
  target.updated += Number(part?.updated || 0);
  target.conflicts += Number(part?.conflicts || 0);
  if (Array.isArray(part?.results)) target.results.push(...part.results);
}

export async function syncNistiProductsToCommerce(env, ids = null) {
  if (isPreview(env)) {
    return { skipped: true, reason: 'preview_scope', total: 0, created: 0, linked: 0, updated: 0, conflicts: 0, results: [] };
  }

  const products = await loadNistiProducts(env, ids);
  const summary = { total: 0, created: 0, linked: 0, updated: 0, conflicts: 0, results: [] };

  for (let offset = 0; offset < products.length; offset += 100) {
    const part = await syncBatch(env, products.slice(offset, offset + 100));
    mergeSummary(summary, part);
  }

  return summary;
}

export async function syncNistiProductToCommerce(env, productId) {
  const result = await syncNistiProductsToCommerce(env, [productId]);
  return result.results?.[0] || {
    status: result.skipped ? 'SKIPPED' : 'ERROR',
    action: result.skipped ? 'SKIPPED' : 'ERROR',
    nisti_product_id: Number(productId || 0),
    error: result.reason || 'sync_result_missing'
  };
}

export async function syncNistiProductToCommerceSafe(env, productId) {
  try {
    return await syncNistiProductToCommerce(env, productId);
  } catch (error) {
    console.error('[NISTI→Commerce] Falha ao sincronizar produto', productId, error);
    return {
      status: 'ERROR',
      action: 'ERROR',
      nisti_product_id: Number(productId || 0),
      error: error?.message || 'commerce_sync_failed'
    };
  }
}

export async function nistiCommerceSyncStatus(env) {
  const totalRow = await env.DB.prepare('SELECT COUNT(*) AS total FROM products').first();
  let commerce = null;
  if (!isPreview(env)) {
    commerce = await supabaseRpc(env, 'commerce_nisti_sync_status_v1', {});
  }
  return {
    nisti_products: Number(totalRow?.total || 0),
    commerce: commerce || { linked_total: 0, conflicts: 0, errors: 0, last_synced_at: null },
    preview: isPreview(env)
  };
}


export async function nistiCommerceProductStatuses(env) {
  if (isPreview(env)) return [];
  const rows = await supabaseRpc(env, 'commerce_nisti_product_statuses_v1', {});
  return Array.isArray(rows) ? rows : [];
}
