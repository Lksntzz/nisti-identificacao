import {
  mirrorDeletedProductToSupabase,
  mirrorDeletedVisualReferenceToSupabase,
  mirrorOccurrenceStateFromD1,
  mirrorProductCatalogBatchFromD1,
  mirrorProductCatalogFromD1,
  mirrorTrainedOccurrenceArtifactsFromD1,
  mirrorVisualReferenceFromD1,
  supabaseMirrorWritesRequested
} from './supabase-write-store.js';

function successful(response) {
  return Number(response?.status || 0) >= 200 && Number(response?.status || 0) < 300;
}

async function responseJson(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function requestJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function mirrorSuccessfulMutation(request, response, env) {
  if (!successful(response) || !supabaseMirrorWritesRequested(env)) return;

  const url = new URL(request.url);
  const method = String(request.method || 'GET').toUpperCase();

  try {
    if (method === 'POST' && url.pathname === '/api/products') {
      const data = await responseJson(response);
      await mirrorProductCatalogFromD1(env, data?.id);
      return;
    }

    if (method === 'POST' && url.pathname === '/api/admin/bulk-products') {
      const data = await responseJson(response);
      const ids = (data?.imported || []).map(item => item?.id);
      await mirrorProductCatalogBatchFromD1(env, ids);
      return;
    }

    const productSingle = url.pathname.match(/^\/api\/products\/(\d+)$/);
    if (productSingle && method === 'DELETE') {
      await mirrorDeletedProductToSupabase(env, Number(productSingle[1]));
      return;
    }
    if (productSingle && (method === 'PUT' || method === 'PATCH')) {
      await mirrorProductCatalogFromD1(env, Number(productSingle[1]));
      return;
    }

    const imageUpload = url.pathname.match(/^\/api\/products\/(\d+)\/image$/);
    if (imageUpload && method === 'POST') {
      const productId = Number(imageUpload[1]);
      const data = await responseJson(response);
      await mirrorProductCatalogFromD1(env, productId);
      if (data?.reference_id) {
        await mirrorVisualReferenceFromD1(env, data.reference_id);
      }
      for (const referenceId of data?.removed_reference_ids || []) {
        await mirrorDeletedVisualReferenceToSupabase(env, referenceId);
      }
      return;
    }

    const coverReferences = url.pathname.match(/^\/api\/admin\/covers\/([^/]+)\/references$/);
    if (coverReferences && method === 'POST') {
      const data = await responseJson(response);
      await mirrorVisualReferenceFromD1(env, data?.reference?.id);
      return;
    }

    const deleteReference = url.pathname.match(/^\/api\/admin\/cover-references\/(\d+)$/);
    if (deleteReference && method === 'DELETE') {
      await mirrorDeletedVisualReferenceToSupabase(env, Number(deleteReference[1]));
      return;
    }

    const trainOccurrence = url.pathname.match(/^\/api\/admin\/occurrences\/(\d+)\/train$/);
    if (trainOccurrence && method === 'POST') {
      await mirrorTrainedOccurrenceArtifactsFromD1(env, Number(trainOccurrence[1]));
      return;
    }

    const dismissOccurrence = url.pathname.match(/^\/api\/admin\/occurrences\/(\d+)\/dismiss$/);
    if (dismissOccurrence && method === 'POST') {
      await mirrorOccurrenceStateFromD1(env, Number(dismissOccurrence[1]));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/operator/confirm-selection') {
      const body = await requestJson(request);
      await mirrorTrainedOccurrenceArtifactsFromD1(env, body?.occurrence_id);
    }
  } catch (error) {
    // D1 has already committed and remains authoritative in mirror mode.
    // Do not manufacture distributed rollback semantics; surface divergence in logs.
    console.error('[Supabase mirror] pós-mutation falhou', {
      method,
      path: url.pathname,
      message: error?.message || String(error)
    });
  }
}
