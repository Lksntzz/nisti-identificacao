import { commerceRpc as supabaseRpc } from './commerce-rpc.js';

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
  const rows = await supabaseRpc(env, 'commerce_list_products_v3', {
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

export async function commerceProductDetail(env, productId) {
  const id = cleanId(productId);
  if (!id) throw new Error('product_id inválido.');
  const result = await supabaseRpc(env, 'commerce_product_platform_detail_v2', {
    p_product_id: id
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceListings(env, filters = {}) {
  const limit = cleanPageSize(filters.limit);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_listings_v4', {
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

export async function commerceManagement(env, filters = {}) {
  const limit = cleanPageSize(filters.limit);
  const offset = cleanOffset(filters.offset);
  const year = Number(filters.year || 0);
  const rows = await supabaseRpc(env, 'commerce_management_rows_v1', {
    p_source_code: cleanText(filters.source) || 'AMAZON',
    p_search: cleanText(filters.search),
    p_category: cleanText(filters.category),
    p_update_status: cleanText(filters.updateStatus),
    p_video_status: cleanText(filters.videoStatus),
    p_listing_status: cleanText(filters.listingStatus),
    p_image_status: cleanText(filters.imageStatus),
    p_relation_status: cleanText(filters.relationStatus),
    p_year: Number.isInteger(year) && year > 0 ? year : null,
    p_limit: limit,
    p_offset: offset
  });

  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceManagementDetail(env, sourceRowId) {
  const id = cleanId(sourceRowId);
  if (!id) throw new Error('source_row_id inválido.');
  const result = await supabaseRpc(env, 'commerce_management_detail_v1', {
    p_source_row_id: id
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceImportBatches(env, filters = {}) {
  const limit = cleanPageSize(filters.limit, 30);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_import_batches_v1', {
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
  return await supabaseRpc(env, 'commerce_import_batch_v2', { p_batch_id: id });
}

export async function commerceReconcileImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_reconcile_import_batch_v5', { p_batch_id: id });
}

export async function commerceImportRows(env, batchId, filters = {}) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  const limit = cleanPageSize(filters.limit);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_import_rows_v1', {
    p_batch_id: id,
    p_status: cleanText(filters.status),
    p_limit: limit,
    p_offset: offset
  });
  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceDecideImportRow(env, rowId, action, productId = null) {
  const id = cleanId(rowId);
  if (!id) throw new Error('import_row_id inválido.');
  const product = productId == null ? null : cleanId(productId);
  return await supabaseRpc(env, 'commerce_decide_import_row_v1', {
    p_import_row_id: id,
    p_action: cleanText(action),
    p_product_id: product
  });
}

export async function commerceApproveNewRows(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  const count = await supabaseRpc(env, 'commerce_approve_new_rows_v2', { p_batch_id: id });
  return Number(count || 0);
}

export async function commerceApproveProbableRows(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  const result = await supabaseRpc(env, 'commerce_approve_probable_rows_v1', { p_batch_id: id });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceCommitImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_commit_import_batch_v3', { p_batch_id: id });
}


export async function commerceReconciliationQueue(env, filters = {}) {
  const limit = cleanPageSize(filters.limit, 50);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_reconciliation_queue_v1', {
    p_limit: limit,
    p_offset: offset
  });
  return { items: Array.isArray(rows) ? rows : [], limit, offset };
}

export async function commerceResolveReconciliationListing(env, listingId, input = {}) {
  const id = cleanId(listingId);
  if (!id) throw new Error('listing_id inválido.');
  const productId = input.productId == null ? null : cleanId(input.productId);
  const categoryId = input.categoryId == null ? null : cleanId(input.categoryId);
  const platformSkus = Array.isArray(input.platformSkus)
    ? input.platformSkus.map(cleanText).filter(Boolean).slice(0, 100)
    : null;
  return await supabaseRpc(env, 'commerce_resolve_reconciliation_listing_v1', {
    p_listing_id: id,
    p_action: cleanText(input.action),
    p_product_id: productId,
    p_product_name: cleanText(input.productName),
    p_category_id: categoryId,
    p_platform_skus: platformSkus,
    p_apply_family: Boolean(input.applyFamily),
    p_resolve: input.resolve !== false,
    p_operator: cleanText(input.operator)
  });
}


export async function commerceShopeeSnapshot(env, filters = {}) {
  const limit = cleanPageSize(filters.limit, 40);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_shopee_snapshot_v1', {
    p_search: cleanText(filters.search),
    p_match_status: cleanText(filters.status),
    p_limit: limit,
    p_offset: offset
  });
  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}
