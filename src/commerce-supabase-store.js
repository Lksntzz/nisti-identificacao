import { commerceRpc as supabaseRpc } from './commerce-rpc.js';
import { supabaseRpc as directSupabaseRpc } from './supabase-read-store.js';

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


export async function commerceSalesDashboard(env, filters = {}) {
  const limit = Math.max(1, Math.min(250, Number(filters.limit || 100) || 100));
  const offset = cleanOffset(filters.offset);
  const result = await supabaseRpc(env, 'commerce_sales_dashboard_v1', {
    p_platform: cleanText(filters.platform) || 'TODAS',
    p_period_start: cleanText(filters.periodStart),
    p_period_end: cleanText(filters.periodEnd),
    p_sku: cleanText(filters.sku),
    p_status: cleanText(filters.status) || 'TODOS',
    p_limit: limit,
    p_offset: offset
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

// Ranking ABC uses imported sales only; does not attribute SKU-level sales to individual ads.
export async function commerceSalesAbc(env, filters = {}) {
  const value = await supabaseRpc(env, 'commerce_sales_abc_v1', {
    p_platform: cleanText(filters.platform) || 'TODAS',
    p_period_start: cleanText(filters.periodStart),
    p_period_end: cleanText(filters.periodEnd),
    p_basis: cleanText(filters.basis) || 'REVENUE'
  });
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function commerceSalesProductPerformance(env, filters = {}) {
  const limit = Math.max(1, Math.min(250, Number(filters.limit || 100) || 100));
  const offset = cleanOffset(filters.offset);
  const result = await supabaseRpc(env, 'commerce_sales_product_performance_v1', {
    p_platform: cleanText(filters.platform) || 'TODAS',
    p_period_start: cleanText(filters.periodStart),
    p_period_end: cleanText(filters.periodEnd),
    p_situation: cleanText(filters.situation) || 'TODOS',
    p_search: cleanText(filters.search),
    p_limit: limit,
    p_offset: offset
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceDashboard(env) {
  const result = await supabaseRpc(env, 'commerce_dashboard_v1');
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function nistiProductsSalesPlanning(env, filters = {}) {
  const ids = [...new Set((Array.isArray(filters.productIds) ? filters.productIds : [])
    .map(cleanId).filter(Boolean))].slice(0,100);
  if (!ids.length) return { items: [] };
  return await directSupabaseRpc(env,'nisti_products_sales_planning_v1',{
    p_nisti_ids:ids,
    p_platform:cleanText(filters.platform)||'TODAS',
    p_months:Math.max(1,Math.min(12,Number(filters.months)||3))
  });
}

export async function commerceProductSalesPlanning(env, filters = {}) {
  const ids = [...new Set((Array.isArray(filters.productIds) ? filters.productIds : [])
    .map(cleanId).filter(Boolean))].slice(0,100);
  if (!ids.length) return { items: [] };
  const result = await supabaseRpc(env,'commerce_product_sales_planning_v1',{
    p_product_ids:ids,
    p_platform:cleanText(filters.platform)||'TODAS',
    p_months:Math.max(1,Math.min(12,Number(filters.months)||3))
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {items:[]};
}

export async function commerceProducts(env, filters = {}) {
  const limit = cleanPageSize(filters.limit);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, filters.presence && filters.presence !== 'ALL'
    ? 'commerce_list_products_planning_cards_v1' : 'commerce_list_products_v3', {
    p_search: cleanText(filters.search),
    p_marketplace_code: cleanText(filters.marketplace),
    p_category_id: cleanId(filters.categoryId),
    p_internal_status: cleanText(filters.status),
    p_limit: limit,
    p_offset: offset,
    ...(filters.presence && filters.presence !== 'ALL' ? {p_presence:filters.presence} : {})
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

export async function commerceListingHistory(env, { group = 'ALL', accountCode = 'ALL', limit = 30, offset = 0 } = {}) {
  const normalizedGroup = String(group || 'ALL').toUpperCase();
  if (!['ALL', 'ACTIVE', 'DEACTIVATED', 'UNKNOWN'].includes(normalizedGroup)) throw new Error('Filtro de anúncios inválido.');
  const normalizedAccount = String(accountCode || 'ALL').toUpperCase();
  if (!['ALL', 'ANTIGO', 'NOVO', 'UNASSIGNED'].includes(normalizedAccount)) throw new Error('Conta de anúncios inválida.');
  const result = await supabaseRpc(env, 'commerce_listing_history_account_v1', {
    p_group: normalizedGroup,
    p_account_code: normalizedAccount,
    p_limit: cleanPageSize(limit, 30),
    p_offset: cleanOffset(offset)
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

// One NISTI SKU per Catalog row. Marketplace listings remain separate child records.
// The Catalog is based on ACTIVE seller advertisements, regardless of Scanner synchronization.
export async function commerceActiveProductCatalog(env, filters = {}) {
  const data = await supabaseRpc(env, 'commerce_active_product_catalog_v1', {
    p_search: cleanText(filters.search),
    p_marketplace_code: cleanText(filters.marketplace),
    p_limit: cleanPageSize(filters.limit, 25),
    p_offset: cleanOffset(filters.offset)
  });
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data : { items: [], total: 0, active_ads: 0 };
}

export async function commerceSkuListingGroups(env, filters = {}) {
  const data = await supabaseRpc(env, 'commerce_sku_listing_groups_v1', {
    p_search: cleanText(filters.search),
    p_marketplace_code: cleanText(filters.marketplace),
    p_period_month: cleanText(filters.periodMonth) ? cleanText(filters.periodMonth) + '-01' : null,
    p_limit: cleanPageSize(filters.limit, 25),
    p_offset: cleanOffset(filters.offset)
  });
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data : { items: [], total: 0 };
}

export async function commerceSaveListingSales(env, input = {}, operator = 'Administrador') {
  const listingId = cleanId(input.listingId);
  const productId = cleanId(input.productId);
  const units = Number(input.units);
  const month = String(input.periodMonth || '').trim();
  if (!listingId || !productId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    || !Number.isSafeInteger(units) || units < 0 || units > 100000000) {
    throw new Error('Dados de vendas por anúncio inválidos.');
  }
  return await supabaseRpc(env, 'commerce_save_listing_sales_v1', {
    p_listing_id: listingId,
    p_nisti_product_id: productId,
    p_period_month: month + '-01',
    p_units: units,
    p_actor: String(operator || 'Administrador').slice(0,120)
  });
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

  const items = Array.isArray(rows) ? rows : [];
  // The active Catalog is listing-centric. Fetch child variants by the
  // marketplace variation ID, including items not linked to a Scanner SKU yet.
  if (cleanText(filters.status) === 'ACTIVE' && items.length) {
    const listingIds = items
      .map(item => cleanId(item.listing_id))
      .filter(Boolean);
    const sourceVariations = listingIds.length
      ? await supabaseRpc(env, 'commerce_catalog_listing_variations_v1', {
          p_listing_ids: listingIds
        })
      : [];
    const byListingId = new Map(
      (Array.isArray(sourceVariations) ? sourceVariations : [])
        .map(row => [Number(row.listing_id), Array.isArray(row.variations) ? row.variations : []])
    );
    return {
      items: items.map(item => ({
        ...item,
        catalog_variations: byListingId.get(Number(item.listing_id))
          || (Array.isArray(item.variation_options) ? item.variation_options : [])
      })),
      limit,
      offset
    };
  }

  return { items, limit, offset };
}

export async function commerceManagementProducts(env, filters = {}) {
  const limit = cleanPageSize(filters.limit, 24);
  const offset = cleanOffset(filters.offset);
  const year = Number(filters.year || 0);
  const presence = cleanText(filters.presence) || 'LINKED';
  const rpcName = presence === 'LINKED'
    ? 'commerce_management_products_fast_v1'
    : 'commerce_management_products_v3';
  const params = rpcName === 'commerce_management_products_fast_v1'
    ? {
        p_search: cleanText(filters.search),
        p_category: cleanText(filters.category),
        p_year: Number.isInteger(year) && year > 0 ? year : null,
        p_limit: limit,
        p_offset: offset
      }
    : {
        p_search: cleanText(filters.search),
        p_category: cleanText(filters.category),
        p_year: Number.isInteger(year) && year > 0 ? year : null,
        p_presence: cleanText(filters.presence) || 'LINKED',
        p_limit: limit,
        p_offset: offset
      };
  const rows = await supabaseRpc(env, rpcName, params);

  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceManagementLinkCandidates(env, sourceRowId) {
  const id = cleanId(sourceRowId);
  if (!id) throw new Error('source_row_id inválido.');
  const result = await supabaseRpc(env, 'commerce_management_link_candidates_v2', {
    p_source_row_id: id
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceResolveManagementLink(env, sourceRowId, productId, operator = null) {
  const rowId = cleanId(sourceRowId);
  const linkedProductId = cleanId(productId);
  if (!rowId) throw new Error('source_row_id inválido.');
  if (!linkedProductId) throw new Error('product_id inválido.');
  const result = await supabaseRpc(env, 'commerce_management_resolve_link_v1', {
    p_source_row_id: rowId,
    p_product_id: linkedProductId,
    p_operator: cleanText(operator)
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceManagementProductSummary(env) {
  const result = await supabaseRpc(env, 'commerce_management_product_summary_v2');
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
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

export async function commerceManagementFilterOptions(env, sourceCode = 'AMAZON') {
  const result = await supabaseRpc(env, 'commerce_management_filter_options_v1', {
    p_source_code: cleanText(sourceCode) || 'AMAZON'
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceManagementSummary(env, sourceCode = 'AMAZON') {
  const result = await supabaseRpc(env, 'commerce_management_summary_v1', {
    p_source_code: cleanText(sourceCode) || 'AMAZON'
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
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
  const batchId = await supabaseRpc(env, 'commerce_create_import_batch_v2', {
    p_marketplace_code: cleanText(input.marketplace),
    p_source_filename: cleanText(input.filename),
    p_source_sha256: cleanText(input.sha256),
    p_created_by: cleanText(input.createdBy),
    p_account_code: cleanText(input.accountCode)
  });
  const id = Number(batchId || 0);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Supabase não retornou um batch_id válido.');
  return id;
}

export async function commerceDeleteImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_delete_import_batch_v1', { p_batch_id: id });
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
  return await supabaseRpc(env, 'commerce_import_batch_account_v1', { p_batch_id: id });
}

export async function commerceReconcileImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_reconcile_import_batch_auto_v1', { p_batch_id: id }, { timeoutMs: 30000 });
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

export async function commerceSyncImportListingStates(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_sync_import_listing_states_account_v1', { p_batch_id: id });
}

export async function commerceCommitImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_commit_import_batch_account_v4', { p_batch_id: id });
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


export async function commerceSalesImportBatches(env, filters = {}) {
  const limit = cleanPageSize(filters.limit, 30);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_sales_imports_v1', {
    p_limit: limit,
    p_offset: offset
  });
  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceCreateSalesImport(env, input = {}) {
  const batchId = await supabaseRpc(env, 'commerce_create_sales_import_v1', {
    p_platform_code: cleanText(input.platform),
    p_source_filename: cleanText(input.filename),
    p_source_sha256: cleanText(input.sha256),
    p_created_by: cleanText(input.createdBy)
  });
  const id = Number(batchId || 0);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Supabase não retornou um batch_id de vendas válido.');
  return id;
}

export async function commerceAppendSalesImportRows(env, batchId, rows = []) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id de vendas inválido.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) {
    throw new Error('Cada lote de vendas deve conter entre 1 e 100 linhas.');
  }
  return Number(await supabaseRpc(env, 'commerce_append_sales_import_rows_v1', {
    p_batch_id: id,
    p_rows: rows
  }, { timeoutMs: 8000 }) || 0);
}

export async function commerceAppendSalesImportSummary(env, batchId, rows = []) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id de vendas inválido.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) {
    throw new Error('O resumo de vendas deve conter entre 1 e 100 períodos.');
  }
  return Number(await supabaseRpc(env, 'commerce_append_sales_import_summary_v1', {
    p_batch_id: id,
    p_rows: rows
  }, { timeoutMs: 8000 }) || 0);
}

export async function commerceCommitSalesImport(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id de vendas inválido.');
  const result = await supabaseRpc(env, 'commerce_commit_sales_import_v1', {
    p_batch_id: id
  }, { timeoutMs: 20000 });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceCatalogYearTargets(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  const rows = await supabaseRpc(env, 'commerce_catalog_year_targets_v1', { p_batch_id: id });
  return { items: Array.isArray(rows) ? rows : [] };
}

export async function commerceCatalogYearDecision(env, rowId, action, actor) {
  const id = cleanId(rowId);
  if (!id || !['REGISTER_PENDING','CONFIRM_PLATFORM'].includes(action)) throw new Error('Decisão PB27 inválida.');
  return supabaseRpc(env, 'commerce_catalog_year_decision_v1', {
    p_import_row_id: id,
    p_action: action,
    p_actor: cleanText(actor)
  });
}
