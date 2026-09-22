import { supabaseRpc } from './supabase-read-store.js';

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function cleanId(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function cleanInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function cleanLimit(value, fallback = 50) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(number)));
}

function cleanOffset(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

export async function commerceUpdateCampaigns(env, filters = {}) {
  const limit = cleanLimit(filters.limit, 30);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_update_campaigns_v1', {
    p_limit: limit,
    p_offset: offset
  });
  return { items: Array.isArray(rows) ? rows : [], limit, offset };
}

export async function commerceCreateUpdateCampaign(env, input = {}) {
  return await supabaseRpc(env, 'commerce_create_update_campaign_v1', {
    p_name: cleanText(input.name),
    p_source_year: cleanInteger(input.sourceYear),
    p_target_year: cleanInteger(input.targetYear),
    p_created_by: cleanText(input.createdBy)
  });
}

export async function commerceUpdateItems(env, campaignId, filters = {}) {
  const id = cleanId(campaignId);
  if (!id) throw new Error('campaign_id inválido.');
  const limit = cleanLimit(filters.limit);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_update_items_v1', {
    p_campaign_id: id,
    p_status: cleanText(filters.status),
    p_marketplace_code: cleanText(filters.marketplace),
    p_search: cleanText(filters.search),
    p_limit: limit,
    p_offset: offset
  });
  return { items: Array.isArray(rows) ? rows : [], limit, offset };
}

export async function commerceUpdateItem(env, itemId) {
  const id = cleanId(itemId);
  if (!id) throw new Error('item_id inválido.');
  return await supabaseRpc(env, 'commerce_update_item_v1', { p_item_id: id });
}

export async function commerceSetUpdateCheck(env, checkId, input = {}) {
  const id = cleanId(checkId);
  if (!id) throw new Error('check_id inválido.');
  return await supabaseRpc(env, 'commerce_set_update_check_v1', {
    p_check_id: id,
    p_status: cleanText(input.status),
    p_detected_value: cleanText(input.detectedValue),
    p_expected_value: cleanText(input.expectedValue),
    p_notes: cleanText(input.notes),
    p_checked_by: cleanText(input.checkedBy)
  });
}

export async function commerceCloseUpdateCampaign(env, campaignId) {
  const id = cleanId(campaignId);
  if (!id) throw new Error('campaign_id inválido.');
  return await supabaseRpc(env, 'commerce_close_update_campaign_v1', { p_campaign_id: id });
}
