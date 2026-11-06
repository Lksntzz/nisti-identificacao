import { commerceRpc as supabaseRpc } from './commerce-rpc.js';

function cleanId(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export async function commerceSetListingState(env, listingId, input = {}) {
  const id = cleanId(listingId);
  if (!id) throw new Error('listing_id inválido.');
  return await supabaseRpc(env, 'commerce_set_listing_state_v1', {
    p_listing_id: id,
    p_listing_status: cleanText(input.listingStatus),
    p_sales_status: cleanText(input.salesStatus),
    p_video_status: cleanText(input.videoStatus),
    p_checked_by: cleanText(input.checkedBy)
  });
}
