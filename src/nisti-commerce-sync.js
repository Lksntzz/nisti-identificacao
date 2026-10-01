import { supabaseReadsRequested, supabaseReserveProducts, supabaseRpc } from './supabase-read-store.js';

const COMMERCE_SYNC_TIMEOUT_MS = 8000;
const COMMERCE_RECONCILE_TIMEOUT_MS = 15000;

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

  if (supabaseReadsRequested(env)) {
    const rows=await supabaseReserveProducts(env);
    const wanted=idList.length ? new Set(idList) : null;
    return (rows || [])
      .filter(row=>!wanted || wanted.has(Number(row.id)))
      .map(normalizeRow)
      .sort((a,b)=>a.id-b.id);
  }

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
  }, { timeoutMs: COMMERCE_SYNC_TIMEOUT_MS });

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

function retryableSyncError(error) {
  const code = String(error?.code || '').toLowerCase();
  const status = Number(error?.status || 0);
  return Boolean(
    error?.fallbackEligible
    || status === 408
    || status === 429
    || status >= 500
    || code.includes('timeout')
    || code.includes('transport')
  );
}

export async function syncNistiProductToCommerceSafe(env, productId) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await syncNistiProductToCommerce(env, productId);
    } catch (error) {
      lastError = error;
      if (attempt === 1 && retryableSyncError(error)) {
        console.warn('[NISTI→Commerce] Tentando novamente após falha temporária', productId, error?.code || error?.message);
        await new Promise(resolve => setTimeout(resolve, 150));
        continue;
      }
      break;
    }
  }

  console.error('[NISTI→Commerce] Falha ao sincronizar produto', productId, lastError);
  return {
    status: 'ERROR',
    action: 'ERROR',
    nisti_product_id: Number(productId || 0),
    error: lastError?.message || 'commerce_sync_failed'
  };
}

export async function reconcileNistiProductToCommerceSafe(env, productId) {
  if (isPreview(env)) {
    return { status: 'SKIPPED', reason: 'preview_scope', nisti_product_id: Number(productId || 0) };
  }

  try {
    return await supabaseRpc(env, 'commerce_reconcile_nisti_product_v5', {
      p_nisti_product_id: Number(productId || 0)
    }, { timeoutMs: COMMERCE_RECONCILE_TIMEOUT_MS });
  } catch (error) {
    console.warn('[NISTI→Commerce] Reconciliação histórica ficou pendente', productId, error);
    return {
      status: 'ERROR',
      nisti_product_id: Number(productId || 0),
      error: error?.message || 'commerce_reconcile_failed'
    };
  }
}

export async function nistiCommerceSyncStatus(env) {
  const total = supabaseReadsRequested(env)
    ? (await supabaseReserveProducts(env)).length
    : Number((await env.DB.prepare('SELECT COUNT(*) AS total FROM products').first())?.total || 0);
  let commerce = null;
  if (!isPreview(env)) {
    commerce = await supabaseRpc(env, 'commerce_nisti_sync_status_v1', {});
  }
  return {
    nisti_products: Number(total || 0),
    commerce: commerce || { linked_total: 0, conflicts: 0, errors: 0, last_synced_at: null },
    preview: isPreview(env)
  };
}


export async function nistiCommerceProductStatuses(env) {
  if (isPreview(env)) return [];

  const [rows, platformRows] = await Promise.all([
    supabaseRpc(env, 'commerce_nisti_product_statuses_v1', {}),
    supabaseRpc(env, 'commerce_nisti_product_platforms_v1', {})
  ]);

  const platformsByProduct = new Map(
    (Array.isArray(platformRows) ? platformRows : []).map(item => [
      Number(item.nisti_product_id),
      Array.isArray(item.platforms) ? item.platforms : []
    ])
  );

  return (Array.isArray(rows) ? rows : []).map(row => ({
    ...row,
    platforms: platformsByProduct.get(Number(row.nisti_product_id)) || []
  }));
}
