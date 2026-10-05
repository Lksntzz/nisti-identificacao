import { supabaseRpc } from './supabase-read-store.js';

const WRITE_MODES = new Set(['off', 'mirror', 'primary']);

export class SupabasePrimaryWriteError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'SupabasePrimaryWriteError';
    this.code = cause?.code || 'supabase_primary_write_failed';
    this.status = Number(cause?.status || 0);
  }
}

export function supabaseWriteMode(env) {
  const mode = String(env?.SUPABASE_WRITE_MODE || 'off').trim().toLowerCase() || 'off';
  if (!WRITE_MODES.has(mode)) {
    throw new Error(`SUPABASE_WRITE_MODE inválido para a fase atual: ${mode}`);
  }
  return mode;
}

export function supabaseMirrorWritesRequested(env) {
  return supabaseWriteMode(env) !== 'off';
}

export function supabasePrimaryWritesRequested(env) {
  return supabaseWriteMode(env) === 'primary';
}

export async function mirrorSupabaseRpc(env, rpcName, args, label = rpcName) {
  const mode = supabaseWriteMode(env);
  if (mode === 'off') return { attempted: false, ok: true };

  try {
    const value = await supabaseRpc(env, rpcName, args);
    return { attempted: true, ok: true, value };
  } catch (error) {
    console.error(`[Supabase ${mode}] ${label} falhou`, {
      code: error?.code || 'supabase_mirror_error',
      status: Number(error?.status || 0) || null,
      message: error?.message || String(error)
    });
    if (mode === 'primary') {
      throw new SupabasePrimaryWriteError(
        `Supabase não confirmou a escrita primária: ${label}.`,
        error
      );
    }
    return { attempted: true, ok: false, error };
  }
}

function normalizeIds(values) {
  return [...new Set((values || [])
    .map(value => Number(value || 0))
    .filter(value => Number.isInteger(value) && value > 0))];
}

export async function mirrorProductCatalogBatchFromD1(env, productIds) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const ids = normalizeIds(productIds);
  if (!ids.length) return { attempted: false, ok: true };

  const placeholders = ids.map(() => '?').join(',');
  const [{ results: products }, { results: platforms }] = await Promise.all([
    env.DB.prepare(`
      SELECT id,sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code,
             nome,variacao,image_key,created_at,updated_at
      FROM products
      WHERE id IN (${placeholders})
      ORDER BY id ASC
    `).bind(...ids).all(),
    env.DB.prepare(`
      SELECT id,product_id,platform,link
      FROM product_platforms
      WHERE product_id IN (${placeholders})
      ORDER BY product_id ASC,id ASC
    `).bind(...ids).all()
  ]);

  const present = new Set((products || []).map(row => Number(row.id)));
  const missing = ids.filter(id => !present.has(id));

  const result = await mirrorSupabaseRpc(
    env,
    'nisti_mirror_product_catalog_batch',
    { p_products: products || [], p_platforms: platforms || [] },
    `product catalog batch (${ids.length})`
  );

  for (const id of missing) {
    await mirrorDeletedProductToSupabase(env, id);
  }
  return result;
}

export async function mirrorProductCatalogFromD1(env, productId) {
  const id = Number(productId || 0);
  if (!id) return { attempted: false, ok: true };
  return mirrorProductCatalogBatchFromD1(env, [id]);
}

export async function mirrorDeletedProductToSupabase(env, productId) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const id = Number(productId || 0);
  if (!id) return { attempted: false, ok: true };
  return mirrorSupabaseRpc(
    env,
    'nisti_delete_product_catalog',
    { p_product_id: id },
    `delete product ${id}`
  );
}
