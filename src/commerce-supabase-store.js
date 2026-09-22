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
