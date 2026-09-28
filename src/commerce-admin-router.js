import { SupabaseReadError } from './supabase-read-store.js';
import {
  commerceListings,
  commerceManagementProducts,
  commerceManagementProductSummary,
  commerceManagementLinkCandidates,
  commerceResolveManagementLink,
  commerceProducts,
  commerceProductDetail
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

async function bodyJson(request) {
  try {
    const data = await request.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
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

function positiveId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function commercePreviewSandbox(env) {
  return String(env?.APP_ENV || '').trim().toLowerCase() === 'preview'
    && String(env?.COMMERCE_DATA_SCOPE || '').trim().toLowerCase() === 'preview';
}

function errorResponse(error) {
  if (error instanceof SupabaseReadError) {
    console.error(`[Commerce] Supabase RPC failed: ${error.code}`, error.message);
    const clientError = error.status >= 400 && error.status < 500 && !error.fallbackEligible;
    return json({
      error: clientError
        ? 'Dados inválidos para a operação do Catálogo Comercial.'
        : 'Não foi possível acessar o Catálogo Comercial.',
      technical_error: error.code,
      retryable: Boolean(error.fallbackEligible)
    }, clientError ? 400 : (error.status >= 400 && error.status < 600 ? error.status : 502));
  }

  console.error('[Commerce] unexpected error', error);
  return json({
    error: 'Erro interno no Catálogo Comercial.',
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
  const method = String(request.method || 'GET').toUpperCase();

  if (pathname !== BASE_PATH && !pathname.startsWith(`${BASE_PATH}/`)) return null;

  try {
    if (method === 'GET' && pathname === `${BASE_PATH}/management/products`) {
      return json(paginationPayload(await commerceManagementProducts(env, {
        search: query(url, 'search'),
        category: query(url, 'category'),
        year: query(url, 'year'),
        presence: query(url, 'presence') || 'LINKED',
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      })));
    }

    if (method === 'GET' && pathname === `${BASE_PATH}/management/product-summary`) {
      return json(await commerceManagementProductSummary(env));
    }

    const linkReviewMatch = pathname.match(/^\/api\/admin\/commerce\/management\/link-review\/(\d+)$/);
    if (method === 'GET' && linkReviewMatch) {
      const sourceRowId = positiveId(linkReviewMatch[1]);
      if (!sourceRowId) return json({ error: 'source_row_id inválido.' }, 400);
      return json(await commerceManagementLinkCandidates(env, sourceRowId));
    }

    const linkResolveMatch = pathname.match(/^\/api\/admin\/commerce\/management\/link-review\/(\d+)\/resolve$/);
    if (method === 'POST' && linkResolveMatch) {
      if (!commercePreviewSandbox(env)) {
        return json({
          error: 'A decisão de vínculo está habilitada somente no preview de homologação.',
          technical_error: 'commerce_preview_only',
          retryable: false
        }, 409);
      }

      const sourceRowId = positiveId(linkResolveMatch[1]);
      const body = await bodyJson(request);
      const productId = positiveId(body?.product_id);

      if (!sourceRowId) return json({ error: 'source_row_id inválido.' }, 400);
      if (!productId) return json({ error: 'product_id é obrigatório.' }, 400);

      return json(await commerceResolveManagementLink(
        env,
        sourceRowId,
        productId,
        operatorName(request)
      ));
    }

    if (method === 'GET' && pathname === `${BASE_PATH}/products`) {
      return json(paginationPayload(await commerceProducts(env, {
        search: query(url, 'search'),
        marketplace: query(url, 'marketplace'),
        categoryId: query(url, 'category_id'),
        status: query(url, 'status'),
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      })));
    }

    const productDetailMatch = pathname.match(/^\/api\/admin\/commerce\/products\/(\d+)\/details$/);
    if (method === 'GET' && productDetailMatch) {
      const productId = positiveId(productDetailMatch[1]);
      if (!productId) return json({ error: 'product_id inválido.' }, 400);
      return json(await commerceProductDetail(env, productId));
    }

    if (method === 'GET' && pathname === `${BASE_PATH}/listings`) {
      return json(paginationPayload(await commerceListings(env, {
        search: query(url, 'search'),
        marketplace: query(url, 'marketplace'),
        status: query(url, 'status'),
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      })));
    }

    if (!['GET', 'POST'].includes(method)) {
      return json({ error: 'Método não permitido.' }, 405);
    }

    return json({ error: 'Rota do Catálogo Comercial não encontrada.' }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
