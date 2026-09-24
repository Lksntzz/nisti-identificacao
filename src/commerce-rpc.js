import { supabaseRpc } from './supabase-read-store.js';

export function commerceDataScope(env) {
  const raw = String(env?.COMMERCE_DATA_SCOPE || '').trim().toLowerCase();
  const scope = !raw || raw === 'live'
    ? 'live'
    : raw === 'preview'
      ? 'preview'
      : null;

  if (!scope) throw new Error(`COMMERCE_DATA_SCOPE inválido: ${raw}`);

  const appEnv = String(env?.APP_ENV || '').trim().toLowerCase();
  if (appEnv === 'preview' && scope !== 'preview') {
    throw new Error('Worker preview não pode acessar o Catálogo Comercial live.');
  }
  if (appEnv === 'production' && scope === 'preview') {
    throw new Error('Worker de produção não pode acessar o sandbox comercial.');
  }

  return scope;
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
