import { supabaseRpc } from './supabase-read-store.js';

export function commerceDataScope(env) {
  const raw = String(env?.COMMERCE_DATA_SCOPE || '').trim().toLowerCase();
  if (!raw || raw === 'live') return 'live';
  if (raw === 'preview') return 'preview';
  throw new Error(`COMMERCE_DATA_SCOPE inválido: ${raw}`);
}

export function commerceRpcName(env, rpcName) {
  const name = String(rpcName || '').trim();
  if (!name.startsWith('commerce_')) {
    throw new Error(`RPC comercial inválida: ${name || '(vazia)'}`);
  }
  if (commerceDataScope(env) === 'preview') {
    return name.replace(/^commerce_/, 'commerce_preview_');
  }
  return name;
}

export async function commerceRpc(env, rpcName, args) {
  return await supabaseRpc(env, commerceRpcName(env, rpcName), args);
}
