import { SupabaseReadError } from './supabase-read-store.js';
import {
  commerceDashboard,
  commerceListings,
  commerceProducts
} from './commerce-supabase-store.js';

const BASE_PATH = '/api/admin/commerce';

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

function errorResponse(error) {
  if (error instanceof SupabaseReadError) {
    console.error(`[Commerce] Supabase read failed: ${error.code}`, error.message);
    return json({
      error: 'Não foi possível consultar o Catálogo Comercial.',
      technical_error: error.code,
      retryable: Boolean(error.fallbackEligible)
    }, error.status >= 400 && error.status < 600 ? error.status : 502);
  }

  console.error('[Commerce] unexpected error', error);
  return json({
    error: 'Erro interno ao consultar o Catálogo Comercial.',
    technical_error: 'commerce_internal_error',
    retryable: false
  }, 500);
}

function paginationPayload(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const total = items.length ? Number(items[0]?.total_count || 0) : 0;
  const cleaned = items.map(({ total_count: _totalCount, ...item }) => item);
  return {
    items: cleaned,
    pagination: {
      limit: Number(result?.limit || 50),
      offset: Number(result?.offset || 0),
      total
    }
  };
}

export async function handleCommerceAdminRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname !== BASE_PATH && !pathname.startsWith(`${BASE_PATH}/`)) return null;

  if (request.method !== 'GET') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  try {
    if (pathname === BASE_PATH || pathname === `${BASE_PATH}/dashboard`) {
      return json(await commerceDashboard(env));
    }

    if (pathname === `${BASE_PATH}/health`) {
      const dashboard = await commerceDashboard(env);
      return json({
        ok: true,
        backend: 'supabase',
        products: Number(dashboard?.products || 0),
        listings: Number(dashboard?.listings || 0)
      });
    }

    if (pathname === `${BASE_PATH}/products`) {
      const result = await commerceProducts(env, {
        search: query(url, 'search'),
        marketplace: query(url, 'marketplace'),
        categoryId: query(url, 'category_id'),
        status: query(url, 'status'),
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      });
      return json(paginationPayload(result));
    }

    if (pathname === `${BASE_PATH}/listings`) {
      const result = await commerceListings(env, {
        search: query(url, 'search'),
        marketplace: query(url, 'marketplace'),
        status: query(url, 'status'),
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      });
      return json(paginationPayload(result));
    }

    return json({ error: 'Rota do Catálogo Comercial não encontrada.' }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
