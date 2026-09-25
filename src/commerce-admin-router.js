import { SupabaseReadError } from './supabase-read-store.js';
import {
  commerceAppendImportRows,
  commerceApproveNewRows,
  commerceApproveProbableRows,
  commerceCommitImportBatch,
  commerceCreateImportBatch,
  commerceDashboard,
  commerceDecideImportRow,
  commerceFinalizeImportBatch,
  commerceImportBatch,
  commerceImportBatches,
  commerceImportRows,
  commerceListings,
  commerceManagement,
  commerceProducts,
  commerceProductDetail,
  commerceShopeeSnapshot,
  commerceReconciliationQueue,
  commerceReconcileImportBatch,
  commerceResolveReconciliationListing
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
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data;
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

function commerceCommitEnabled(env) {
  return String(env?.COMMERCE_COMMIT_ENABLED || '').trim() === '1';
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
    if (method === 'GET' && (pathname === BASE_PATH || pathname === `${BASE_PATH}/dashboard`)) {
      return json(await commerceDashboard(env));
    }

    if (method === 'GET' && pathname === `${BASE_PATH}/health`) {
      const dashboard = await commerceDashboard(env);
      return json({
        ok: true,
        backend: 'supabase',
        products: Number(dashboard?.products || 0),
        listings: Number(dashboard?.listings || 0),
        commit_enabled: commerceCommitEnabled(env)
      });
    }

    if (method === 'GET' && pathname === `${BASE_PATH}/management`) {
      const result = await commerceManagement(env, {
        source: query(url, 'source') || 'AMAZON',
        search: query(url, 'search'),
        category: query(url, 'category'),
        updateStatus: query(url, 'update_status'),
        videoStatus: query(url, 'video_status'),
        listingStatus: query(url, 'listing_status'),
        imageStatus: query(url, 'image_status'),
        relationStatus: query(url, 'relation_status'),
        year: query(url, 'year'),
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      });
      return json(paginationPayload(result));
    }

    if (method === 'GET' && pathname === `${BASE_PATH}/products`) {
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

    const productDetailMatch = pathname.match(/^\/api\/admin\/commerce\/products\/(\d+)\/details$/);
    if (method === 'GET' && productDetailMatch) {
      const productId = positiveId(productDetailMatch[1]);
      if (!productId) return json({ error: 'product_id inválido.' }, 400);
      return json(await commerceProductDetail(env, productId));
    }

    if (method === 'GET' && pathname === `${BASE_PATH}/listings`) {
      const result = await commerceListings(env, {
        search: query(url, 'search'),
        marketplace: query(url, 'marketplace'),
        status: query(url, 'status'),
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      });
      return json(paginationPayload(result));
    }

    if (method === 'GET' && pathname === `${BASE_PATH}/shopee-snapshot`) {
      const result = await commerceShopeeSnapshot(env, {
        search: query(url, 'search'),
        status: query(url, 'status'),
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      });
      return json(paginationPayload(result));
    }

    if (method === 'GET' && pathname === `${BASE_PATH}/reconciliation`) {
      const result = await commerceReconciliationQueue(env, {
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      });
      return json(paginationPayload(result));
    }

    const reconciliationResolveMatch = pathname.match(/^\/api\/admin\/commerce\/reconciliation\/(\d+)\/resolve$/);
    if (method === 'POST' && reconciliationResolveMatch) {
      const listingId = positiveId(reconciliationResolveMatch[1]);
      const body = await bodyJson(request);
      const action = String(body?.action || '').trim().toUpperCase();
      const productId = body?.product_id == null ? null : positiveId(body.product_id);
      const categoryId = body?.category_id == null ? null : positiveId(body.category_id);
      const productName = String(body?.product_name || '').trim() || null;
      const platformSkus = Array.isArray(body?.platform_skus)
        ? body.platform_skus.map(value => String(value || '').trim()).filter(Boolean).slice(0, 100)
        : null;

      if (!listingId) return json({ error: 'listing_id inválido.' }, 400);
      if (!['LINK_EXISTING', 'CREATE_NEW', 'MARK_RESOLVED'].includes(action)) {
        return json({ error: 'action inválida.' }, 400);
      }
      if (action === 'LINK_EXISTING' && !productId) {
        return json({ error: 'product_id é obrigatório para LINK_EXISTING.' }, 400);
      }
      if (action === 'CREATE_NEW' && !productName) {
        return json({ error: 'product_name é obrigatório para CREATE_NEW.' }, 400);
      }

      return json(await commerceResolveReconciliationListing(env, listingId, {
        action,
        productId,
        productName,
        categoryId,
        platformSkus,
        applyFamily: body?.apply_family === true,
        resolve: body?.resolve !== false,
        operator: operatorName(request)
      }));
    }

    if (method === 'GET' && pathname === `${BASE_PATH}/imports`) {
      const result = await commerceImportBatches(env, {
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      });
      return json(paginationPayload(result));
    }

    if (method === 'POST' && pathname === `${BASE_PATH}/imports`) {
      const body = await bodyJson(request);
      const marketplace = String(body?.marketplace || '').trim();
      const filename = String(body?.filename || '').trim();
      const sha256 = String(body?.sha256 || '').trim() || null;
      if (!marketplace || !filename) {
        return json({ error: 'marketplace e filename são obrigatórios.' }, 400);
      }
      if (sha256 && !/^[0-9a-f]{64}$/i.test(sha256)) {
        return json({ error: 'sha256 inválido.' }, 400);
      }
      const batchId = await commerceCreateImportBatch(env, {
        marketplace,
        filename,
        sha256,
        createdBy: operatorName(request)
      });
      return json({ batch_id: batchId }, 201);
    }

    const importBatchMatch = pathname.match(/^\/api\/admin\/commerce\/imports\/(\d+)$/);
    if (method === 'GET' && importBatchMatch) {
      const batchId = positiveId(importBatchMatch[1]);
      if (!batchId) return json({ error: 'batch_id inválido.' }, 400);
      const batch = await commerceImportBatch(env, batchId);
      return batch ? json(batch) : json({ error: 'Importação não encontrada.' }, 404);
    }

    const importRowsMatch = pathname.match(/^\/api\/admin\/commerce\/imports\/(\d+)\/rows$/);
    if (method === 'POST' && importRowsMatch) {
      const batchId = positiveId(importRowsMatch[1]);
      const body = await bodyJson(request);
      const rows = body?.rows;
      if (!batchId) return json({ error: 'batch_id inválido.' }, 400);
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) {
        return json({ error: 'rows deve conter entre 1 e 100 linhas.' }, 400);
      }
      const inserted = await commerceAppendImportRows(env, batchId, rows);
      return json({ batch_id: batchId, accepted_rows: inserted });
    }

    if (method === 'GET' && importRowsMatch) {
      const batchId = positiveId(importRowsMatch[1]);
      if (!batchId) return json({ error: 'batch_id inválido.' }, 400);
      const result = await commerceImportRows(env, batchId, {
        status: query(url, 'status'),
        limit: query(url, 'limit'),
        offset: query(url, 'offset')
      });
      return json(paginationPayload(result));
    }

    const importFinalizeMatch = pathname.match(/^\/api\/admin\/commerce\/imports\/(\d+)\/finalize$/);
    if (method === 'POST' && importFinalizeMatch) {
      const batchId = positiveId(importFinalizeMatch[1]);
      if (!batchId) return json({ error: 'batch_id inválido.' }, 400);
      return json(await commerceFinalizeImportBatch(env, batchId));
    }

    const importReconcileMatch = pathname.match(/^\/api\/admin\/commerce\/imports\/(\d+)\/reconcile$/);
    if (method === 'POST' && importReconcileMatch) {
      const batchId = positiveId(importReconcileMatch[1]);
      if (!batchId) return json({ error: 'batch_id inválido.' }, 400);
      return json(await commerceReconcileImportBatch(env, batchId));
    }

    const importApproveNewMatch = pathname.match(/^\/api\/admin\/commerce\/imports\/(\d+)\/approve-new$/);
    if (method === 'POST' && importApproveNewMatch) {
      const batchId = positiveId(importApproveNewMatch[1]);
      if (!batchId) return json({ error: 'batch_id inválido.' }, 400);
      const approved = await commerceApproveNewRows(env, batchId);
      return json({ batch_id: batchId, approved_new_rows: approved });
    }

    const importApproveProbableMatch = pathname.match(/^\/api\/admin\/commerce\/imports\/(\d+)\/approve-probable$/);
    if (method === 'POST' && importApproveProbableMatch) {
      const batchId = positiveId(importApproveProbableMatch[1]);
      if (!batchId) return json({ error: 'batch_id inválido.' }, 400);
      return json(await commerceApproveProbableRows(env, batchId));
    }

    const importCommitMatch = pathname.match(/^\/api\/admin\/commerce\/imports\/(\d+)\/commit$/);
    if (method === 'POST' && importCommitMatch) {
      const batchId = positiveId(importCommitMatch[1]);
      if (!batchId) return json({ error: 'batch_id inválido.' }, 400);
      if (!commerceCommitEnabled(env)) {
        return json({
          error: 'Commit do Catálogo Comercial desabilitado neste ambiente.',
          technical_error: 'commerce_commit_disabled',
          retryable: false
        }, 409);
      }
      return json(await commerceCommitImportBatch(env, batchId));
    }

    const importDecisionMatch = pathname.match(/^\/api\/admin\/commerce\/import-rows\/(\d+)\/decision$/);
    if (method === 'POST' && importDecisionMatch) {
      const rowId = positiveId(importDecisionMatch[1]);
      const body = await bodyJson(request);
      const action = String(body?.action || '').trim().toUpperCase();
      const productId = body?.product_id == null ? null : positiveId(body.product_id);
      if (!rowId) return json({ error: 'row_id inválido.' }, 400);
      if (!['CONFIRM_PRODUCT', 'CREATE_NEW', 'IGNORE'].includes(action)) {
        return json({ error: 'action inválida.' }, 400);
      }
      if (action === 'CONFIRM_PRODUCT' && !productId) {
        return json({ error: 'product_id é obrigatório para CONFIRM_PRODUCT.' }, 400);
      }
      return json(await commerceDecideImportRow(env, rowId, action, productId));
    }

    if (!['GET', 'POST'].includes(method)) {
      return json({ error: 'Método não permitido.' }, 405);
    }

    return json({ error: 'Rota do Catálogo Comercial não encontrada.' }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
