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

  return { items: Array.isArray(rows) ? rows : [], limit, offset };
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

  return { items: Array.isArray(rows) ? rows : [], limit, offset };
}

export async function commerceManagementProducts(env, filters = {}) {
  const limit = cleanPageSize(filters.limit, 24);
  const offset = cleanOffset(filters.offset);
  const year = Number(filters.year || 0);

  const rows = await supabaseRpc(env, 'commerce_management_products_v2', {
    p_search: cleanText(filters.search),
    p_category: cleanText(filters.category),
    p_year: Number.isInteger(year) && year > 0 ? year : null,
    p_presence: cleanText(filters.presence) || 'LINKED',
    p_limit: limit,
    p_offset: offset
  });

  return { items: Array.isArray(rows) ? rows : [], limit, offset };
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
