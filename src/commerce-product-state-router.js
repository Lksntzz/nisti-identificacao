import { SupabaseReadError } from './supabase-read-store.js';
import { commerceSetProductState } from './commerce-product-state-store.js';

const MATCH = /^\/api\/admin\/commerce\/products\/(\d+)\/state$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function bodyJson(request) {
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function operatorName(request) {
  const raw = String(request.headers.get('x-operator-name') || '').trim();
  if (!raw) return 'Administrador';
  try { return decodeURIComponent(raw).trim().slice(0, 120) || 'Administrador'; }
  catch { return raw.slice(0, 120) || 'Administrador'; }
}

export async function handleCommerceProductStateRequest(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(MATCH);
  if (!match) return null;
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const body = await bodyJson(request);
  if (!body) return json({ error: 'JSON inválido.' }, 400);

  try {
    return json(await commerceSetProductState(env, Number(match[1]), {
      internalStatus: body.internal_status,
      checkedBy: operatorName(request)
    }));
  } catch (error) {
    if (error instanceof SupabaseReadError) {
      const clientError = error.status >= 400 && error.status < 500 && !error.fallbackEligible;
      return json({
        error: clientError ? 'Status do Produto Mestre inválido.' : 'Não foi possível atualizar o Produto Mestre.',
        technical_error: error.code
      }, clientError ? 400 : 502);
    }
    console.error('[Commerce Product State] unexpected error', error);
    return json({ error: 'Erro interno ao atualizar o Produto Mestre.' }, 500);
  }
}
