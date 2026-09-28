import { SupabaseReadError } from './supabase-read-store.js';
import {
  commerceListingEditor,
  commerceEditListing,
  commerceBulkEditListings,
  commerceQueueListingSync
} from './commerce-listing-editor-store.js';

const BASE = '/api/admin/commerce/listings';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
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
  try {
    return decodeURIComponent(raw).trim().slice(0, 120) || 'Administrador';
  } catch {
    return raw.slice(0, 120) || 'Administrador';
  }
}

function clientError(error) {
  if (!(error instanceof SupabaseReadError)) return false;
  return error.status >= 400 && error.status < 500 && !error.fallbackEligible;
}

export async function handleCommerceListingEditorRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = String(request.method || 'GET').toUpperCase();

  if (pathname === `${BASE}/bulk-edit`) {
    if (method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const body = await bodyJson(request);
    if (!body) return json({ error: 'JSON inválido.' }, 400);
    try {
      return json(await commerceBulkEditListings(
        env,
        body.listing_ids,
        body.action,
        body.value,
        operatorName(request)
      ));
    } catch (error) {
      if (error instanceof SupabaseReadError) {
        return json({
          error: clientError(error)
            ? 'Não foi possível aplicar a edição em massa. Revise os valores informados.'
            : 'Falha ao aplicar a edição em massa.',
          technical_error: error.code
        }, clientError(error) ? 400 : 502);
      }
      console.error('[Commerce Listing Editor] bulk edit failed', error);
      return json({ error: error?.message || 'Erro interno na edição em massa.' }, 500);
    }
  }

  const editorMatch = pathname.match(/^\/api\/admin\/commerce\/listings\/(\d+)\/editor$/);
  if (editorMatch) {
    if (method !== 'GET') return json({ error: 'Método não permitido.' }, 405);
    try {
      return json(await commerceListingEditor(env, Number(editorMatch[1])));
    } catch (error) {
      if (error instanceof SupabaseReadError) {
        return json({
          error: clientError(error) ? 'Anúncio inválido.' : 'Não foi possível abrir o anúncio.',
          technical_error: error.code
        }, clientError(error) ? 400 : 502);
      }
      console.error('[Commerce Listing Editor] editor read failed', error);
      return json({ error: 'Erro interno ao abrir o anúncio.' }, 500);
    }
  }

  const editMatch = pathname.match(/^\/api\/admin\/commerce\/listings\/(\d+)\/edit$/);
  if (editMatch) {
    if (method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const body = await bodyJson(request);
    if (!body || !body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
      return json({ error: 'patch é obrigatório.' }, 400);
    }
    try {
      return json(await commerceEditListing(env, Number(editMatch[1]), body.patch, operatorName(request)));
    } catch (error) {
      if (error instanceof SupabaseReadError) {
        return json({
          error: clientError(error)
            ? 'Os dados informados para o anúncio são inválidos.'
            : 'Não foi possível salvar o anúncio.',
          technical_error: error.code
        }, clientError(error) ? 400 : 502);
      }
      console.error('[Commerce Listing Editor] edit failed', error);
      return json({ error: 'Erro interno ao salvar o anúncio.' }, 500);
    }
  }

  const syncMatch = pathname.match(/^\/api\/admin\/commerce\/listings\/(\d+)\/sync$/);
  if (syncMatch) {
    if (method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    try {
      return json(await commerceQueueListingSync(env, Number(syncMatch[1]), operatorName(request)));
    } catch (error) {
      if (error instanceof SupabaseReadError) {
        return json({
          error: clientError(error) ? 'Anúncio inválido.' : 'Não foi possível colocar o anúncio na fila de sincronização.',
          technical_error: error.code
        }, clientError(error) ? 400 : 502);
      }
      console.error('[Commerce Listing Editor] sync queue failed', error);
      return json({ error: 'Erro interno ao preparar a sincronização.' }, 500);
    }
  }

  return null;
}
