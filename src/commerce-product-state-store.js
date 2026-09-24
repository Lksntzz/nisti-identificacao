import { commerceRpc as supabaseRpc } from './commerce-rpc.js';

function cleanId(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export async function commerceSetProductState(env, productId, input = {}) {
  const id = cleanId(productId);
  if (!id) throw new Error('product_id inválido.');

  return await supabaseRpc(env, 'commerce_set_product_state_v1', {
    p_product_id: id,
    p_internal_status: cleanText(input.internalStatus),
    p_checked_by: cleanText(input.checkedBy)
  });
}
