import { supabaseRpc } from './supabase-read-store.js';

const WRITE_MODES = new Set(['off', 'mirror']);

export function supabaseWriteMode(env) {
  const mode = String(env?.SUPABASE_WRITE_MODE || 'off').trim().toLowerCase() || 'off';
  if (!WRITE_MODES.has(mode)) {
    throw new Error(`SUPABASE_WRITE_MODE inválido para a fase atual: ${mode}`);
  }
  return mode;
}

export function supabaseMirrorWritesRequested(env) {
  return supabaseWriteMode(env) === 'mirror';
}

export async function mirrorSupabaseRpc(env, rpcName, args, label = rpcName) {
  const mode = supabaseWriteMode(env);
  if (mode === 'off') return { attempted: false, ok: true };

  try {
    await supabaseRpc(env, rpcName, args);
    return { attempted: true, ok: true };
  } catch (error) {
    console.error(`[Supabase mirror] ${label} falhou`, {
      code: error?.code || 'supabase_mirror_error',
      status: Number(error?.status || 0) || null,
      message: error?.message || String(error)
    });
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

export async function mirrorVisualReferenceFromD1(env, referenceId) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const id = Number(referenceId || 0);
  if (!id) return { attempted: false, ok: true };

  const reference = await env.DB.prepare(`
    SELECT id,capa_code,image_key,source_product_id,reference_kind,active,created_at,updated_at
    FROM cover_visual_references
    WHERE id=?
    LIMIT 1
  `).bind(id).first();

  if (!reference) {
    return mirrorSupabaseRpc(
      env,
      'nisti_delete_visual_reference',
      { p_reference_id: id },
      `delete visual reference ${id}`
    );
  }

  const embedding = await env.DB.prepare(`
    SELECT reference_id,embedding_model,dimensions,embedding_json,updated_at
    FROM cover_reference_embeddings
    WHERE reference_id=?
    LIMIT 1
  `).bind(id).first();

  return mirrorSupabaseRpc(
    env,
    'nisti_mirror_visual_reference',
    { p_reference: reference, p_embedding: embedding || null },
    `visual reference ${id}`
  );
}

export async function mirrorDeletedVisualReferenceToSupabase(env, referenceId) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const id = Number(referenceId || 0);
  if (!id) return { attempted: false, ok: true };
  return mirrorSupabaseRpc(
    env,
    'nisti_delete_visual_reference',
    { p_reference_id: id },
    `delete visual reference ${id}`
  );
}

export async function mirrorOccurrenceStateFromD1(env, occurrenceId) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const id = Number(occurrenceId || 0);
  if (!id) return { attempted: false, ok: true };

  const row = await env.DB.prepare(`
    SELECT id,image_key,platform,suggested_capa_code,confidence,error_reason,
           operator_name,operator_id,status,trained_capa_code,trained_at,created_at
    FROM scan_occurrences
    WHERE id=?
    LIMIT 1
  `).bind(id).first();

  if (!row) return { attempted: false, ok: true };

  return mirrorSupabaseRpc(
    env,
    'nisti_mirror_occurrence_state',
    { p_row: row },
    `scan occurrence state ${id}`
  );
}

export async function mirrorTrainedOccurrenceArtifactsFromD1(env, occurrenceId) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const id = Number(occurrenceId || 0);
  if (!id) return { attempted: false, ok: true };

  const occurrence = await env.DB.prepare(`
    SELECT id,image_key,trained_capa_code,status
    FROM scan_occurrences
    WHERE id=?
    LIMIT 1
  `).bind(id).first();

  await mirrorOccurrenceStateFromD1(env, id);

  if (String(occurrence?.status || '') !== 'trained' || !occurrence?.image_key || !occurrence?.trained_capa_code) {
    return { attempted: true, ok: true };
  }

  const reference = await env.DB.prepare(`
    SELECT id
    FROM cover_visual_references
    WHERE image_key=? AND UPPER(TRIM(capa_code))=UPPER(TRIM(?))
    ORDER BY id DESC
    LIMIT 1
  `).bind(occurrence.image_key, occurrence.trained_capa_code).first();

  if (reference?.id) {
    return mirrorVisualReferenceFromD1(env, reference.id);
  }
  return { attempted: true, ok: true };
}
