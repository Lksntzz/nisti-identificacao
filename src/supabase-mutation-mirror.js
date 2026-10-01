import {
  mirrorDeletedProductToSupabase,
  mirrorDeletedVisualReferenceToSupabase,
  mirrorOccurrenceStateFromD1,
  mirrorProductCatalogBatchFromD1,
  mirrorProductCatalogFromD1,
  mirrorTrainedOccurrenceArtifactsFromD1,
  mirrorVisualReferenceFromD1,
  supabaseMirrorWritesRequested,
  supabasePrimaryWritesRequested
} from './supabase-write-store.js';
import {
  mirrorAllMuralPostsFromD1,
  mirrorMuralCollectionFromD1,
  mirrorMuralPostFromD1,
  mirrorMuralPostReadFromD1,
  mirrorMuralReadsForUserFromD1,
  mirrorNotificationByCapaFromD1,
  mirrorProductImageDerivativeFromD1
} from './supabase-secondary-write-store.js';

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

function isDirectSupabasePrimaryMutation(url, method) {
  if (method === 'POST' && (url.pathname === '/api/products' || url.pathname === '/api/admin/bulk-products')) return true;
  if (method === 'POST' && url.pathname === '/api/admin/mural/posts') return true;
  if (/^\/api\/admin\/mural\/posts\/\d+$/.test(url.pathname) && method === 'PUT') return true;
  if (/^\/api\/admin\/mural\/posts\/\d+\/(?:publish|archive|duplicate)$/.test(url.pathname) && method === 'POST') return true;
  if (/^\/api\/products\/\d+$/.test(url.pathname) && ['PUT', 'PATCH', 'DELETE'].includes(method)) return true;
  if (/^\/api\/products\/\d+\/image$/.test(url.pathname) && method === 'POST') return true;
  if (/^\/api\/admin\/product-image-treatment\/\d+(?:\/(?:approve|redo|failed))?$/.test(url.pathname) && method === 'POST') return true;
  if (/^\/api\/admin\/covers\/[^/]+\/references$/.test(url.pathname) && method === 'POST') return true;
  if (/^\/api\/admin\/cover-references\/\d+$/.test(url.pathname) && method === 'DELETE') return true;
  if (/^\/api\/admin\/occurrences\/\d+\/dismiss$/.test(url.pathname) && method === 'POST') return true;
  if (/^\/api\/products\/\d+\/finish$/.test(url.pathname) && method === 'PATCH') return true;
  if (/^\/api\/products\/\d+\/gtins$/.test(url.pathname) && method === 'POST') return true;
  return /^\/api\/products\/\d+\/gtins\/[^/]+$/.test(url.pathname) && method === 'DELETE';
}

export async function mirrorSuccessfulMutation(request, response, env) {
  if (!successful(response) || !supabaseMirrorWritesRequested(env)) return;

  const url = new URL(request.url);
  const method = String(request.method || 'GET').toUpperCase();
  if (supabasePrimaryWritesRequested(env) && isDirectSupabasePrimaryMutation(url, method)) return;

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

    const productFinish = url.pathname.match(/^\/api\/products\/(\d+)\/finish$/);
    if (productFinish && method === 'PATCH') {
      await mirrorProductCatalogFromD1(env, Number(productFinish[1]));
      return;
    }

    const imageUpload = url.pathname.match(/^\/api\/products\/(\d+)\/image$/);
    if (imageUpload && method === 'POST') {
      const productId = Number(imageUpload[1]);
      const data = await responseJson(response);
      await mirrorProductCatalogFromD1(env, productId);
      await mirrorProductImageDerivativeFromD1(env, productId);
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

    if (method === 'POST' && url.pathname === '/api/admin/mural/posts') {
      const data=await responseJson(response);
      await mirrorMuralPostFromD1(env,data?.id);
      return;
    }

    const muralAdminPost=url.pathname.match(/^\/api\/admin\/mural\/posts\/(\d+)$/);
    if (muralAdminPost && (method === 'PUT' || method === 'DELETE')) {
      await mirrorMuralPostFromD1(env,Number(muralAdminPost[1]));
      return;
    }

    const muralPostAction=url.pathname.match(/^\/api\/admin\/mural\/posts\/(\d+)\/(publish|archive|duplicate)$/);
    if (muralPostAction && method === 'POST') {
      const data=await responseJson(response);
      if (muralPostAction[2] === 'duplicate') {
        await mirrorMuralPostFromD1(env,data?.id);
      } else {
        await mirrorMuralPostFromD1(env,Number(muralPostAction[1]));
      }
      return;
    }

    const muralPostImage=url.pathname.match(/^\/api\/admin\/mural\/posts\/(\d+)\/image$/);
    if (muralPostImage && (method === 'POST' || method === 'DELETE')) {
      await mirrorMuralPostFromD1(env,Number(muralPostImage[1]));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/admin/mural/collections') {
      const data=await responseJson(response);
      await mirrorMuralCollectionFromD1(env,data?.id);
      return;
    }

    const muralCollection=url.pathname.match(/^\/api\/admin\/mural\/collections\/(\d+)$/);
    if (muralCollection && method === 'PUT') {
      await mirrorMuralCollectionFromD1(env,Number(muralCollection[1]));
      return;
    }

    const muralCollectionProducts=url.pathname.match(/^\/api\/admin\/mural\/collections\/(\d+)\/products$/);
    if (muralCollectionProducts && method === 'PUT') {
      await mirrorMuralCollectionFromD1(env,Number(muralCollectionProducts[1]));
      return;
    }

    const muralCollectionImage=url.pathname.match(/^\/api\/admin\/mural\/collections\/(\d+)\/image$/);
    if (muralCollectionImage && (method === 'POST' || method === 'DELETE')) {
      await mirrorMuralCollectionFromD1(env,Number(muralCollectionImage[1]));
      return;
    }

    const muralCollectionPublish=url.pathname.match(/^\/api\/admin\/mural\/collections\/(\d+)\/publish$/);
    if (muralCollectionPublish && method === 'POST') {
      await mirrorMuralCollectionFromD1(env,Number(muralCollectionPublish[1]));
      await mirrorAllMuralPostsFromD1(env);
      return;
    }

    const muralRead=url.pathname.match(/^\/api\/mural\/(\d+)\/read$/);
    if (muralRead && method === 'POST') {
      const user=String(request.headers.get('x-user-id') || 'anonymous').trim().slice(0,100) || 'anonymous';
      await mirrorMuralPostReadFromD1(env,Number(muralRead[1]),user);
      return;
    }

    if (method === 'POST' && url.pathname === '/api/mural/mark-all-read') {
      const user=String(request.headers.get('x-user-id') || 'anonymous').trim().slice(0,100) || 'anonymous';
      await mirrorMuralReadsForUserFromD1(env,user);
      return;
    }

    const automaticProductImage = url.pathname.match(/^\/api\/admin\/product-image-treatment\/(\d+)(?:\/failed)?$/);
    if (automaticProductImage && method === 'POST') {
      await mirrorProductImageDerivativeFromD1(env, Number(automaticProductImage[1]));
      return;
    }

    const muralProductImage = url.pathname.match(/^\/api\/admin\/mural\/products\/(\d+)\/image$/);
    if (muralProductImage && (method === 'POST' || method === 'DELETE')) {
      await mirrorProductImageDerivativeFromD1(env, Number(muralProductImage[1]));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/admin/notifications/test') {
      const data = await responseJson(response);
      await mirrorNotificationByCapaFromD1(env, data?.capa_code);
      return;
    }

    if (method === 'POST' && url.pathname === '/api/operator/confirm-selection') {
      const body = await requestJson(request);
      await mirrorTrainedOccurrenceArtifactsFromD1(env, body?.occurrence_id);
    }
  } catch (error) {
    // D1 has already committed at this transitional boundary. Mirror mode logs
    // divergence, while primary mode fails closed so callers never mistake a
    // D1-only commit for an authoritative Supabase commit.
    console.error('[Supabase write] pós-mutation falhou', {
      method,
      path: url.pathname,
      message: error?.message || String(error)
    });
    if (supabasePrimaryWritesRequested(env)) throw error;
  }
}
