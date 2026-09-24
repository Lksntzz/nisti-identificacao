import { SupabaseReadError } from './supabase-read-store.js';
import {
  commerceCloseUpdateCampaign,
  commerceCreateUpdateCampaign,
  commerceSetUpdateCheck,
  commerceUpdateCampaigns,
  commerceUpdateItem,
  commerceUpdateItems
} from './commerce-update-store.js';

const BASE_PATH = '/api/admin/commerce/update-campaigns';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function query(url, name) {
  const value = url.searchParams.get(name);
  return value == null ? null : value;
}

async function bodyJson(request) {
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function positiveId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
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

function paginationPayload(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const total = items.length ? Number(items[0]?.total_count || 0) : 0;
  return {
    items: items.map(({ total_count: _total, ...item }) => item),
    pagination: {
      limit: Number(result?.limit || 50),
      offset: Number(result?.offset || 0),
      total
    }
  };
}

function errorResponse(error) {
  if (error instanceof SupabaseReadError) {
    console.error(`[Commerce Update] Supabase RPC failed: ${error.code}`, error.message);
    const clientError = error.status >= 400 && error.status < 500 && !error.fallbackEligible;
    return json({
      error: clientError ? 'Operação de atualização inválida.' : 'Não foi possível acessar a atualização anual.',
      technical_error: error.code,
      retryable: Boolean(error.fallbackEligible)
    }, clientError ? 400 : (error.status >= 400 && error.status < 600 ? error.status : 502));
  }
  console.error('[Commerce Update] unexpected error', error);
  return json({ error: 'Erro interno na atualização anual.', technical_error: 'commerce_update_internal_error' }, 500);
}

export async function handleCommerceUpdateAdminRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = String(request.method || 'GET').toUpperCase();
  if (pathname !== BASE_PATH && !pathname.startsWith(`${BASE_PATH}/`)) return null;

  try {
    if (pathname === BASE_PATH && method === 'GET') {
      return json(paginationPayload(await commerceUpdateCampaigns(env, {
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      })));
    }

    if (pathname === BASE_PATH && method === 'POST') {
      const body = await bodyJson(request);
      const sourceYear = Number(body?.source_year);
      const targetYear = Number(body?.target_year);
      const name = String(body?.name || '').trim();
      if (!name || !Number.isInteger(sourceYear) || !Number.isInteger(targetYear)) {
        return json({ error: 'name, source_year e target_year são obrigatórios.' }, 400);
      }
      return json(await commerceCreateUpdateCampaign(env, {
        name,
        sourceYear,
        targetYear,
        createdBy: operatorName(request)
      }), 201);
    }

    const itemsMatch = pathname.match(/^\/api\/admin\/commerce\/update-campaigns\/(\d+)\/items$/);
    if (itemsMatch && method === 'GET') {
      const campaignId = positiveId(itemsMatch[1]);
      if (!campaignId) return json({ error: 'campaign_id inválido.' }, 400);
      return json(paginationPayload(await commerceUpdateItems(env, campaignId, {
        status: query(url, 'status'),
        marketplace: query(url, 'marketplace'),
        search: query(url, 'search'),
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      })));
    }

    const closeMatch = pathname.match(/^\/api\/admin\/commerce\/update-campaigns\/(\d+)\/close$/);
    if (closeMatch && method === 'POST') {
      const campaignId = positiveId(closeMatch[1]);
      if (!campaignId) return json({ error: 'campaign_id inválido.' }, 400);
      return json(await commerceCloseUpdateCampaign(env, campaignId));
    }

    const itemMatch = pathname.match(/^\/api\/admin\/commerce\/update-campaigns\/items\/(\d+)$/);
    if (itemMatch && method === 'GET') {
      const itemId = positiveId(itemMatch[1]);
      if (!itemId) return json({ error: 'item_id inválido.' }, 400);
      const item = await commerceUpdateItem(env, itemId);
      return item ? json(item) : json({ error: 'Item de atualização não encontrado.' }, 404);
    }

    const checkMatch = pathname.match(/^\/api\/admin\/commerce\/update-campaigns\/checks\/(\d+)$/);
    if (checkMatch && method === 'POST') {
      const checkId = positiveId(checkMatch[1]);
      const body = await bodyJson(request);
      const status = String(body?.status || '').trim().toUpperCase();
      if (!checkId || !status) return json({ error: 'check_id e status são obrigatórios.' }, 400);
      return json(await commerceSetUpdateCheck(env, checkId, {
        status,
        detectedValue: body?.detected_value,
        expectedValue: body?.expected_value,
        notes: body?.notes,
        checkedBy: operatorName(request)
      }));
    }

    if (!['GET', 'POST'].includes(method)) return json({ error: 'Método não permitido.' }, 405);
    return json({ error: 'Rota de atualização anual não encontrada.' }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
