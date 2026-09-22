import { supabaseRpc } from './supabase-read-store.js';

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function cleanId(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function cleanPageSize(value, fallback = 50) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(number)));
}

function cleanOffset(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

export async function commerceDashboard(env) {
  const result = await supabaseRpc(env, 'commerce_dashboard_v1');
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceProducts(env, filters = {}) {
  const limit = cleanPageSize(filters.limit);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_products_v1', {
    p_search: cleanText(filters.search),
    p_marketplace_code: cleanText(filters.marketplace),
    p_category_id: cleanId(filters.categoryId),
    p_internal_status: cleanText(filters.status),
    p_limit: limit,
    p_offset: offset
  });

  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceListings(env, filters = {}) {
  const limit = cleanPageSize(filters.limit);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_listings_v1', {
    p_search: cleanText(filters.search),
    p_marketplace_code: cleanText(filters.marketplace),
    p_listing_status: cleanText(filters.status),
    p_limit: limit,
    p_offset: offset
  });

  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceCreateImportBatch(env, input = {}) {
  const batchId = await supabaseRpc(env, 'commerce_create_import_batch_v1', {
    p_marketplace_code: cleanText(input.marketplace),
    p_source_filename: cleanText(input.filename),
    p_source_sha256: cleanText(input.sha256),
    p_created_by: cleanText(input.createdBy)
  });
  const id = Number(batchId || 0);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Supabase não retornou um batch_id válido.');
  return id;
}

export async function commerceAppendImportRows(env, batchId, rows = []) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) {
    throw new Error('Cada lote deve conter entre 1 e 100 linhas.');
  }
  const inserted = await supabaseRpc(env, 'commerce_append_import_rows_v1', {
    p_batch_id: id,
    p_rows: rows
  });
  return Number(inserted || 0);
}

export async function commerceFinalizeImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_finalize_import_batch_v1', { p_batch_id: id });
}

export async function commerceImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_import_batch_v1', { p_batch_id: id });
}
