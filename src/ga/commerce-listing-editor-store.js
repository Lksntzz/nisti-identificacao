import { commerceRpc } from './commerce-rpc.js';

function cleanId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export async function commerceListingEditor(env, listingId) {
  const id = cleanId(listingId);
  if (!id) throw new Error('listing_id inválido.');
  const result = await commerceRpc(env, 'commerce_listing_editor_v1', { p_listing_id: id });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceEditListing(env, listingId, patch, operator) {
  const id = cleanId(listingId);
  if (!id) throw new Error('listing_id inválido.');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch inválido.');
  return await commerceRpc(env, 'commerce_edit_listing_v1', {
    p_listing_id: id,
    p_patch: patch,
    p_operator: cleanText(operator),
    p_batch_token: null
  });
}

export async function commerceBulkEditListings(env, listingIds, action, value, operator) {
  const ids = Array.isArray(listingIds)
    ? [...new Set(listingIds.map(cleanId).filter(Boolean))]
    : [];
  if (!ids.length) throw new Error('listing_ids são obrigatórios.');
  if (ids.length > 500) throw new Error('O limite por edição em massa é 500 anúncios.');
  return await commerceRpc(env, 'commerce_bulk_edit_listings_v1', {
    p_listing_ids: ids,
    p_action: cleanText(action),
    p_value: value == null ? null : String(value),
    p_operator: cleanText(operator)
  });
}

export async function commerceQueueListingSync(env, listingId, operator) {
  const id = cleanId(listingId);
  if (!id) throw new Error('listing_id inválido.');
  return await commerceRpc(env, 'commerce_queue_listing_sync_v1', {
    p_listing_id: id,
    p_operator: cleanText(operator)
  });
}
