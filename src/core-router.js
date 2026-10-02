import { parseSku } from './sku.js';
import { requireValidGtin13 } from './gtin.js';
import {
  recordNewCoverNotification,
  updateNotificationImage,
  listUserNotifications,
  getUnreadNotificationsCount,
  markNotificationRead,
  markAllNotificationsRead
} from './cover-notifications.js';
import {
  getVapidPublicKey,
  savePushSubscription,
  removePushSubscription,
  sendWebPushNotification,
  broadcastNewCoverPush
} from './web-push.js';
import {
  platformVectorId,
  supportedPlatforms,
  platformsForReference,
  platformNamespace,
  normalizePlatform
} from './platform-scope.js';
import {
  supabaseReserveProducts,
  supabaseProductImageContext,
  supabaseCoverReferences,
  supabaseReferenceById,
  supabaseReadsRequested,
  supabaseRpc,
  supabaseProductTreatmentSummary,
  supabaseProductTreatmentQueue
} from './supabase-read-store.js';
import { mirrorSupabaseRpc, supabasePrimaryWritesRequested } from './supabase-write-store.js';
import {
  syncNistiProductsToCommerce,
  syncNistiProductToCommerceSafe,
  reconcileNistiProductToCommerceSafe,
  nistiCommerceSyncStatus,
  nistiCommerceProductStatuses
} from './nisti-commerce-sync.js';
import {
  listAdminSystemNotifications,
  getAdminSystemUnreadCount,
  markAdminSystemNotificationRead,
  markAllAdminSystemNotificationsRead
} from './system-notifications.js';

const EMBEDDING_DIMENSIONS = 768;
const TOP_K_REFERENCES = 24;
const BULK_IMPORT_LIMIT = 100;
const EXTRA_REFERENCE_LIMIT = 6;
const MAX_REFERENCE_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_TREATED_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;
const PRODUCT_IMAGE_PROCESSOR_VERSION = '8';
const PRODUCT_IMAGE_PROCESSOR = 'system-official-mask';

function scheduleCommerceReconcile(ctx, env, productId, commerceSync) {
  const id = Number(productId || 0);
  const status = String(commerceSync?.status || '').toUpperCase();
  if (!ctx?.waitUntil || !Number.isInteger(id) || id <= 0 || status !== 'SYNCED') return;

  ctx.waitUntil(
    reconcileNistiProductToCommerceSafe(env, id)
      .catch(error => console.warn('[NISTI→Commerce] Reconciliação em segundo plano falhou', id, error))
  );
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeCapaCode(value) {
  return String(value || '').trim().toUpperCase();
}

function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function referenceImageUrl(reference) {
  if (!reference?.id || !reference?.image_key) return null;
  const version = String(reference.image_key).split('/').pop() || 'current';
  return `/api/reference-images/${reference.id}?v=${encodeURIComponent(version)}`;
}

function productOriginalImageUrl(productId, imageKey) {
  if (!productId || !imageKey) return null;
  return `/api/images/${Number(productId)}?v=${encodeURIComponent(String(imageKey))}`;
}

function productDisplayImageUrl(productId, imageKey, processedImageKey = null) {
  if (!productId || !imageKey) return null;
  const version = processedImageKey || imageKey;
  return `/api/product-images/${Number(productId)}?v=${encodeURIComponent(String(version))}`;
}

function inspectTransparentPng(bytes) {
  const view = new Uint8Array(bytes);
  const signature = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
  if (view.length < 33 || signature.some((value,index)=>view[index]!==value)) return null;
  const dataView = new DataView(bytes);
  const width = dataView.getUint32(16);
  const height = dataView.getUint32(20);
  const colorType = view[25];
  if (![4,6].includes(colorType) || width < 1 || height < 1 || width > 6000 || height > 6000) return null;
  return { width, height };
}

async function embedImage(env, bytes, mimeType) {async function embedImage(env, bytes, mimeType) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        content: {
          parts: [{
            inline_data: {
              mime_type: mimeType || 'image/jpeg',
              data: base64(bytes)
            }
          }]
        },
        output_dimensionality: EMBEDDING_DIMENSIONS
      })
    }
  );
  if (!response.ok) throw new Error(`Gemini Embedding falhou (${response.status})`);
  const payload = await response.json();
  const values = payload?.embedding?.values || payload?.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error('Gemini Embedding não retornou vetor válido');
  }
  return { model, values };
}

async function storeReferenceEmbedding(env, reference, bytes, mimeType, cleanupProductId = null) {
  if (!reference?.id) throw new Error('Referência visual não encontrada');
  const { model, values } = await embedImage(env, bytes, mimeType);

  const referenceId = Number(reference.id);
  const capaCode = String(reference.capa_code || '').trim().toUpperCase();
  let platforms = await platformsForReference(env, reference);
  if (!platforms.length) platforms = supportedPlatforms();

  const vectors = platforms.map(platform => {
    const normalizedPlatform = normalizePlatform(platform);
    const namespace = platformNamespace(normalizedPlatform);
    return {
      id: platformVectorId(referenceId, normalizedPlatform),
      namespace,
      values,
      metadata: {
        reference_id: referenceId,
        capa_code: capaCode,
        platform: normalizedPlatform,
        platform_key: namespace,
        image_key: String(reference.image_key || ''),
        source_product_id: Number(reference.source_product_id || 0),
        reference_kind: String(reference.reference_kind || 'product'),
        embedding_model: model,
        updated_at: new Date().toISOString()
      }
    };
  }).filter(v => v.id && v.namespace);

  if (!env.COVER_VECTORS?.upsert) throw new Error('Binding COVER_VECTORS não configurado');
  if (!vectors.length) throw new Error('Nenhum namespace de plataforma disponível para a referência visual');

  await env.COVER_VECTORS.upsert(vectors);

  const stored = await mirrorSupabaseRpc(env, 'nisti_store_reference_embedding_v1', {
    p_reference_id:referenceId,
    p_embedding_model:model,
    p_dimensions:values.length,
    p_embedding_json:JSON.stringify(values),
    p_cleanup_product_id:cleanupProductId,
    p_keep_image_key:cleanupProductId ? reference.image_key : null
  }, 'embedding de referência visual');
  if (stored.value?.status !== 'ok') throw new Error('Referência visual não encontrada no Supabase');

  const removedReferences = stored.value?.removed_references || [];
  if (removedReferences.length && env.COVER_VECTORS?.deleteByIds) {
    const staleVectorIds = removedReferences.flatMap(item =>
      supportedPlatforms()
        .map(platform => platformVectorId(Number(item.id), platform))
        .filter(Boolean)
    );
    if (staleVectorIds.length) {
      await env.COVER_VECTORS.deleteByIds(staleVectorIds).catch(error => {
        console.warn('[Vectorize] Falha ao remover vetores obsoletos:', error?.message || error);
      });
    }
  }

  return { model, values, removedReferences, vectorized:vectors.length };
}

async function saveProductImage(env, id, fileBytes, contentType) {
  const key = `products/${id}/${crypto.randomUUID()}`;
  await env.PRODUCT_IMAGES.put(key,fileBytes,{ httpMetadata:{ contentType } });

  let prepared;
  try {
    prepared = await mirrorSupabaseRpc(env,'nisti_prepare_product_image_v1',{
      p_product_id:id,p_image_key:key
    },'imagem original de produto');
  } catch (error) {
    await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
    throw error;
  }

  const value=prepared.value || {};
  if(value.status==='not_found') {
    await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
    throw new Error('Produto não encontrado');
  }

  if(value.old_processed_image_key) {
    await env.PRODUCT_IMAGES.delete(value.old_processed_image_key).catch(()=>{});
  }

  const reference=value.reference;
  let indexed=false,indexError=null,removedReferences=[];
  try {
    const stored=await storeReferenceEmbedding(env,reference,new Uint8Array(fileBytes),contentType,id);
    indexed=true;
    removedReferences=stored.removedReferences || [];
    for(const stale of removedReferences) {
      if(stale.image_key && stale.image_key!==key) {
        await env.PRODUCT_IMAGES.delete(stale.image_key).catch(()=>{});
      }
    }
  } catch(error) {
    indexError=error?.message || 'Falha ao indexar capa';
  }

  return {
    indexed,
    index_error:indexError,
    reference_id:Number(reference?.id||0),
    removed_reference_ids:removedReferences.map(item=>Number(item.id))
  };
}

async function upsertCatalogProduct(env, row, { syncCommerce = true } = {}) {
  const parsed = parseSku(row?.sku);
  const nome = clean(row?.nome);
  const variacao = clean(row?.variacao);
  const platform = clean(row?.platform)?.toUpperCase() || null;
  const link = clean(row?.link);
  const gtin = clean(row?.gtin);
  const validGtin = gtin ? requireValidGtin13(gtin) : null;

  const result = await mirrorSupabaseRpc(env, 'nisti_upsert_product_primary_v1', {
    p_row: {
      sku: parsed.sku,
      miolo_code: parsed.mioloCode,
      capa_code: parsed.capaCode,
      acabamento_code: parsed.acabamentoCode,
      wireo_code: parsed.wireoCode,
      tassel_code: parsed.tasselCode,
      elastico_code: parsed.elasticoCode,
      nome,
      variacao,
      platform,
      link,
      gtin: validGtin
    }
  }, 'cadastro de produto');

  const saved = result.value || {};
  if (saved.status === 'gtin_conflict') {
    throw new Error(`EAN ${validGtin} já está vinculado a outro produto.`);
  }

  const commerceSync = syncCommerce
    ? await syncNistiProductToCommerceSafe(env, Number(saved.id))
    : null;

  return {
    id:Number(saved.id),
    sku:saved.sku,
    capa_code:saved.capa_code,
    gtin:saved.gtin || null,
    created:saved.created === true,
    has_image:saved.has_image === true,
    commerce_sync:commerceSync
  };
}

async function listCoverReferences(env, capaCode) {
  const results=await supabaseCoverReferences(env,normalizeCapaCode(capaCode));
  return results.map(reference=>({
    ...reference,
    id:Number(reference.id),
    source_product_id:reference.source_product_id?Number(reference.source_product_id):null,
    indexed:Number(reference.dimensions||0)===EMBEDDING_DIMENSIONS,
    image_url:referenceImageUrl(reference)
  }));
}

async function addCoverReference(env, capaCode, file, kind) {
  const code = normalizeCapaCode(capaCode);
  if (!(file instanceof File)) throw new Error('Imagem de referência obrigatória');
  if (!String(file.type||'').startsWith('image/')) throw new Error('Arquivo deve ser uma imagem');
  if (Number(file.size||0)>MAX_REFERENCE_UPLOAD_BYTES) throw new Error('Imagem de referência excede 10 MB');

  const referenceKind=['real','perspective','personalized','difficult'].includes(String(kind||'').trim().toLowerCase())
    ? String(kind).trim().toLowerCase()
    : 'real';
  const key=`cover-references/${encodeURIComponent(code)}/${crypto.randomUUID()}`;
  const bytes=await file.arrayBuffer();
  await env.PRODUCT_IMAGES.put(key,bytes,{httpMetadata:{contentType:file.type||'image/jpeg'}});

  let prepared;
  try {
    prepared=await mirrorSupabaseRpc(env,'nisti_prepare_extra_reference_v1',{
      p_capa_code:code,p_image_key:key,p_reference_kind:referenceKind
    },'referência visual extra');
  } catch(error) {
    await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
    throw error;
  }

  if(prepared.value?.status!=='ok') {
    await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
    if(prepared.value?.status==='cover_not_found') throw new Error('CAPA_CODE não encontrado no catálogo');
    if(prepared.value?.status==='limit_reached') throw new Error(`Máximo de ${EXTRA_REFERENCE_LIMIT} referências adicionais por capa`);
    throw new Error('Falha ao criar referência visual');
  }

  const reference=prepared.value.reference;
  let indexed=false,indexError=null;
  try {
    await storeReferenceEmbedding(env,reference,new Uint8Array(bytes),file.type||'image/jpeg');
    indexed=true;
  } catch(error) {
    indexError=error?.message||'Falha ao indexar referência';
  }

  return {
    ...reference,
    id:Number(reference.id),
    indexed,
    embedding_error:indexError,
    image_url:referenceImageUrl(reference)
  };
}

async function deleteExtraReference(env, referenceId) {
  const result=await mirrorSupabaseRpc(
    env,
    'nisti_delete_extra_reference_v1',
    {p_reference_id:referenceId},
    'exclusão de referência visual'
  );
  if(result.value?.status==='not_found') throw new Error('Referência visual não encontrada');
  if(result.value?.status==='protected') {
    throw new Error('A referência principal do produto deve ser alterada pelo mockup do produto');
  }

  const reference=result.value?.reference;
  if(env.COVER_VECTORS?.deleteByIds) {
    const vectorIds=supportedPlatforms().map(p=>platformVectorId(referenceId,p)).filter(Boolean);
    if(vectorIds.length) await env.COVER_VECTORS.deleteByIds(vectorIds).catch(()=>{});
  }
  if(reference?.image_key) await env.PRODUCT_IMAGES.delete(reference.image_key).catch(()=>{});

  return {
    id:Number(reference.id),
    capa_code:normalizeCapaCode(reference.capa_code),
    vector_id:`ref:${Number(reference.id)}`
  };
}

export default {export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') {
        const supabaseReads = supabaseReadsRequested(env);
        const supabaseWrites = supabasePrimaryWritesRequested(env);
        const d1Attached = Boolean(env?.DB);
        return json({
          ok: true,
          service: 'nisti-identificacao',
          database: {
            primary: supabaseReads ? 'supabase' : 'd1',
            write_authority: supabaseWrites ? 'supabase' : 'd1',
            d1_binding_configured:d1Attached,
            compatibility_store:d1Attached ? 'd1' : 'detached',
            emergency_fallback_enabled:false,
            d1_reserve_circuit_open:false,
            d1_reserve_circuit_open_until:null,
            d1_reserve_circuit_remaining_ms:0
          }
        });
      }

      if (url.pathname === '/api/sku/parse' && request.method === 'POST') {
        const { sku } = await request.json();
        return json(parseSku(sku));
      }

      if (url.pathname === '/api/products' && request.method === 'GET') {
        const results = await supabaseReserveProducts(env);
        return json({
          products:(results || []).map(product => {
            const treatedReady = product.treated_image_status === 'approved'
              && product.treated_image_key
              && product.treated_source_image_key === product.image_key
              && product.treated_image_reviewed_by === 'admin';
            return {
              ...product,
              has_active_gtin:product.has_active_gtin === true || Number(product.has_active_gtin) === 1,
              original_image_url:productOriginalImageUrl(product.id,product.image_key),
              image_url:product.image_key
                ? productDisplayImageUrl(product.id,product.image_key,treatedReady ? product.treated_image_key : null)
                : null,
              treated_image_ready:Boolean(treatedReady)
            };
          }),
          reserve_mode:true,
          read_source:'supabase'
        },200,{'x-nisti-db-source':'supabase'});
      }

      if (url.pathname === '/api/products' && request.method === 'POST') {
        const body = await request.json();
        const saved = await upsertCatalogProduct(env, body);
        scheduleCommerceReconcile(ctx, env, saved.id, saved.commerce_sync);
        return json({ ok: true, ...saved }, saved.created ? 201 : 200);
      }

      if (url.pathname === '/api/admin/commerce-sync/nisti-products' && request.method === 'GET') {
        return json({ ok: true, ...(await nistiCommerceSyncStatus(env)) });
      }

      if (url.pathname === '/api/admin/commerce-sync/nisti-products' && request.method === 'POST') {
        const synced = await syncNistiProductsToCommerce(env);
        return json({ ok: true, ...synced });
      }

      const repairCommerceSync = url.pathname.match(/^\/api\/admin\/commerce-sync\/nisti-products\/(\d+)\/repair$/);
      if (repairCommerceSync && request.method === 'POST') {
        const productId = Number(repairCommerceSync[1]);
        const product = (await supabaseReserveProducts(env))
          .find(row=>Number(row.id)===productId);
        if (!product) return json({ error: 'Produto não encontrado' }, 404);

        const sync = await syncNistiProductToCommerceSafe(env, productId);
        const syncStatus = String(sync?.status || sync?.sync_status || '').toUpperCase();
        const reconcile = syncStatus === 'SYNCED'
          ? await reconcileNistiProductToCommerceSafe(env, productId)
          : {
              status: 'SKIPPED',
              reason: 'sync_not_confirmed',
              nisti_product_id: productId
            };

        return json({
          ok: syncStatus === 'SYNCED' && String(reconcile?.status || '').toUpperCase() !== 'ERROR',
          product_id: productId,
          sku: product.sku,
          sync,
          reconcile
        });
      }

      if (url.pathname === '/api/admin/commerce-sync/nisti-products/statuses' && request.method === 'GET') {
        const statuses = await nistiCommerceProductStatuses(env);
        return json({ ok: true, statuses });
      }

      if (url.pathname === '/api/admin/bulk-products' && request.method === 'POST') {
        const body = await request.json();
        const rows = Array.isArray(body?.rows) ? body.rows : [];
        if (!rows.length) return json({ error: 'Envie rows com pelo menos um produto' }, 400);
        if (rows.length > BULK_IMPORT_LIMIT) {
          return json({ error: `Máximo de ${BULK_IMPORT_LIMIT} produtos por lote` }, 400);
        }
        const imported = [];
        const errors = [];
        for (let i = 0; i < rows.length; i += 1) {
          try {
            imported.push({ row: i + 1, ...await upsertCatalogProduct(env, rows[i], { syncCommerce: false }) });
          } catch (error) {
            errors.push({ row: i + 1, sku: clean(rows[i]?.sku), error: error?.message || 'Falha ao importar' });
          }
        }
        const syncedIds = imported.map(item => Number(item.id || 0)).filter(Boolean);
        const commerceSync = syncedIds.length
          ? await syncNistiProductsToCommerce(env, syncedIds).catch(error => ({
              status: 'ERROR',
              error: error?.message || 'commerce_bulk_sync_failed'
            }))
          : null;

        return json({
          ok: errors.length === 0,
          received: rows.length,
          created: imported.filter(item => item.created).length,
          updated: imported.filter(item => !item.created).length,
          imported,
          errors,
          commerce_sync: commerceSync
        });
      }

      const productSingle = url.pathname.match(/^\/api\/products\/(\d+)$/);
      if (productSingle && request.method === 'DELETE') {
        const id = Number(productSingle[1]);
        const result = await mirrorSupabaseRpc(
          env,
          'nisti_delete_product_primary_v1',
          { p_id:id },
          'exclusão de produto'
        );
        const deleted = result.value || {};
        if (deleted.status === 'not_found') return json({ error:'Produto não encontrado' },404);

        const keys = new Set([
          deleted.image_key,
          deleted.processed_image_key,
          ...(Array.isArray(deleted.reference_image_keys) ? deleted.reference_image_keys : [])
        ].filter(Boolean));
        for (const key of keys) await env.PRODUCT_IMAGES.delete(key).catch(()=>{});

        return json({ ok:true,deleted_id:id });
      }

      if (productSingle && (request.method === 'PUT' || request.method === 'PATCH')) {
        const id = Number(productSingle[1]);
        const body = await request.json();
        const primaryRow = { ...body };

        if (body.sku) {
          const parsed = parseSku(body.sku);
          Object.assign(primaryRow,{
            sku:parsed.sku,
            miolo_code:parsed.mioloCode,
            capa_code:parsed.capaCode,
            acabamento_code:parsed.acabamentoCode,
            wireo_code:parsed.wireoCode,
            tassel_code:parsed.tasselCode,
            elastico_code:parsed.elasticoCode
          });
        }

        const result = await mirrorSupabaseRpc(env,'nisti_update_product_primary_v1',{
          p_id:id,p_row:primaryRow
        },'edição de produto');
        if (result.value?.status === 'not_found') return json({ error:'Produto não encontrado' },404);

        const commerceSync = await syncNistiProductToCommerceSafe(env,id);
        scheduleCommerceReconcile(ctx,env,id,commerceSync);
        return json({ ok:true,id,updated:true,commerce_sync:commerceSync });
      }

      const imageUpload = url.pathname.match(/^\/api\/products\/(\d+)\/image$/);      const imageUpload = url.pathname.match(/^\/api\/products\/(\d+)\/image$/);
      if (imageUpload && request.method === 'POST') {
        const id = Number(imageUpload[1]);
        const form = await request.formData();
        const file = form.get('image');
        if (!(file instanceof File)) return json({ error: 'Imagem obrigatória' }, 400);
        if (!file.type.startsWith('image/')) return json({ error: 'Arquivo deve ser uma imagem' }, 400);
        const saved = await saveProductImage(env, id, await file.arrayBuffer(), file.type);

        const prod = await supabaseProductImageContext(env,id);
        if (prod?.image_key) {
          await updateNotificationImage(env, id, prod.capa_code, prod.image_key).catch(() => {});
        }

        const commerceSync = await syncNistiProductToCommerceSafe(env, id);
        return json({
          ok: true,
          image_url: productDisplayImageUrl(id, prod?.image_key),
          original_image_url: productOriginalImageUrl(id, prod?.image_key),
          embedding_indexed: saved.indexed,
          embedding_error: saved.index_error,
          reference_id: saved.reference_id,
          removed_reference_ids: saved.removed_reference_ids,
          commerce_sync: commerceSync
        });
      }

      const imageGet = url.pathname.match(/^\/api\/images\/(\d+)$/);
      if (imageGet && request.method === 'GET') {
        const product = await supabaseProductImageContext(env,Number(imageGet[1]));
        if (!product?.image_key) return new Response('Not found',{status:404});

        const object = await env.PRODUCT_IMAGES.get(product.image_key);
        if (!object) return new Response('Not found',{status:404});
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set(
          'cache-control',
          url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'private, max-age=300'
        );
        return new Response(object.body,{headers});
      }

      const displayImageGet = url.pathname.match(/^\/api\/product-images\/(\d+)$/);
      if (displayImageGet && request.method === 'GET') {
        const productId = Number(displayImageGet[1]);
        const row = await supabaseProductImageContext(env,productId);
        if (!row?.image_key || row?.status === 'not_found') return new Response('Not found',{status:404});

        const treatmentStatus=row.treatment_status || row.status;
        const processedReady = treatmentStatus === 'approved'
          && row.processed_image_key
          && row.source_image_key === row.image_key
          && row.reviewed_by === 'admin';

        let object = processedReady ? await env.PRODUCT_IMAGES.get(row.processed_image_key) : null;
        const servedKey = processedReady && object ? row.processed_image_key : row.image_key;
        if (!object) object = await env.PRODUCT_IMAGES.get(row.image_key);
        if (!object) return new Response('Not found',{status:404});

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('x-nisti-image-source',servedKey === row.image_key ? 'original' : 'treated');
        headers.set(
          'cache-control',
          url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'private, max-age=300'
        );
        return new Response(object.body,{headers});
      }

      if (url.pathname === '/api/admin/product-image-treatment/summary' && request.method === 'GET') {
        const summary = await supabaseProductTreatmentSummary(env,PRODUCT_IMAGE_PROCESSOR_VERSION);
        return json({
          ok:true,
          read_source:'supabase',
          processor_version:PRODUCT_IMAGE_PROCESSOR_VERSION,
          summary
        });
      }

      if (url.pathname === '/api/admin/product-image-treatment/pending' && request.method === 'GET') {
        const requestedLimit = Number(url.searchParams.get('limit') || 3);
        const limit = Number.isInteger(requestedLimit) ? Math.max(1,Math.min(100,requestedLimit)) : 3;
        const requestedOffset = Number(url.searchParams.get('offset') || 0);
        const offset = Number.isInteger(requestedOffset) ? Math.max(0,requestedOffset) : 0;
        const requestedStatus = String(url.searchParams.get('status') || 'work').trim().toLowerCase();
        const status = ['work','pending','review','stale','failed'].includes(requestedStatus)
          ? requestedStatus
          : 'work';

        const payload = await supabaseProductTreatmentQueue(
          env,status,PRODUCT_IMAGE_PROCESSOR_VERSION,limit,offset
        );
        const items = Array.isArray(payload?.items) ? payload.items : [];
        return json({
          ok:true,
          read_source:'supabase',
          processor_version:PRODUCT_IMAGE_PROCESSOR_VERSION,
          status:payload?.status || status,
          total:Number(payload?.total || 0),
          limit:Number(payload?.limit || limit),
          offset:Number(payload?.offset || offset),
          items:items.map(row=>({
            id:Number(row.id),
            sku:row.sku || null,
            name:row.name || null,
            tassel_code:row.tassel_code || 'X',
            image_key:row.image_key,
            status:row.status || row.queue_status || 'pending',
            queue_status:row.queue_status || null,
            force_outline:row.processor === 'system-precise-redo',
            original_image_url:productOriginalImageUrl(row.id,row.image_key),
            display_image_url:productDisplayImageUrl(row.id,row.image_key,row.processed_image_key)
          }))
        });
      }

      const treatmentUpload = url.pathname.match(/^\/api\/admin\/product-image-treatment\/(\d+)$/);
      if (treatmentUpload && request.method === 'POST') {
        const productId = Number(treatmentUpload[1]);
        if (!env.PRODUCT_IMAGES) return json({ error:'Armazenamento de imagens indisponível.' },503);

        const product = await supabaseProductImageContext(env,productId);
        if (!product || product.status === 'not_found') return json({ error:'Produto não encontrado.' },404);
        if (!product.image_key) return json({ error:'Produto sem imagem original.' },422);

        const form = await request.formData();
        const file = form.get('image');
        if (!(file instanceof File)) return json({ error:'Envie o PNG tratado no campo image.' },400);
        if (file.size < 1 || file.size > MAX_TREATED_PRODUCT_IMAGE_BYTES) {
          return json({ error:'O PNG tratado deve ter no máximo 8 MB.' },400);
        }

        const bytes = await file.arrayBuffer();
        const png = inspectTransparentPng(bytes);
        if (!png) return json({ error:'O tratamento precisa gerar PNG transparente válido.' },400);

        const key = `processed/products/${productId}/${crypto.randomUUID()}.png`;
        await env.PRODUCT_IMAGES.put(key,bytes,{
          httpMetadata:{contentType:'image/png'},
          customMetadata:{
            sourceImageKey:String(product.image_key),
            processor:PRODUCT_IMAGE_PROCESSOR,
            processorVersion:PRODUCT_IMAGE_PROCESSOR_VERSION,
            width:String(png.width),
            height:String(png.height)
          }
        });

        let saved;
        try {
          saved=await mirrorSupabaseRpc(env,'nisti_set_product_treatment_v1',{
            p_product_id:productId,
            p_action:'review',
            p_processed_image_key:key,
            p_processor:PRODUCT_IMAGE_PROCESSOR,
            p_processor_version:PRODUCT_IMAGE_PROCESSOR_VERSION,
            p_error_message:null
          },'imagem tratada');
        } catch(error) {
          await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
          throw error;
        }

        if(saved.value?.status!=='ok') {
          await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
          return json({error:'Produto não encontrado.'},404);
        }
        if(saved.value.old_processed_image_key && saved.value.old_processed_image_key!==key) {
          await env.PRODUCT_IMAGES.delete(saved.value.old_processed_image_key).catch(()=>{});
        }
        if(product.processed_image_key && product.processed_image_key!==key) {
          await env.PRODUCT_IMAGES.delete(product.processed_image_key).catch(()=>{});
        }

        return json({
          ok:true,
          product_id:productId,
          status:'review',
          processor_version:PRODUCT_IMAGE_PROCESSOR_VERSION,
          original_image_url:productOriginalImageUrl(productId,product.image_key),
          image_url:productDisplayImageUrl(productId,product.image_key,key),
          width:png.width,
          height:png.height
        });
      }

      const treatmentPreview = url.pathname.match(/^\/api\/admin\/product-image-treatment\/(\d+)\/preview$/);
      if (treatmentPreview && request.method === 'GET') {
        const row = await supabaseProductImageContext(env,Number(treatmentPreview[1]));
        if (!row?.processed_image_key || row.source_image_key !== row.image_key) {
          return new Response('Not found',{status:404});
        }
        const object = await env.PRODUCT_IMAGES.get(row.processed_image_key);
        if (!object) return new Response('Not found',{status:404});
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('cache-control','private, no-store');
        headers.set('x-content-type-options','nosniff');
        return new Response(object.body,{headers});
      }

      const treatmentApprove = url.pathname.match(/^\/api\/admin\/product-image-treatment\/(\d+)\/approve$/);
      if (treatmentApprove && request.method === 'POST') {
        const productId = Number(treatmentApprove[1]);
        const saved=await mirrorSupabaseRpc(env,'nisti_set_product_treatment_v1',{
          p_product_id:productId,p_action:'approve',
          p_processed_image_key:null,p_processor:null,p_processor_version:null,p_error_message:null
        },'aprovação de imagem tratada');
        if(saved.value?.status==='not_found') return json({error:'Produto sem imagem original.'},404);
        if(saved.value?.status==='invalid_derivative') {
          return json({error:'Este produto ainda não possui uma imagem tratada válida para aprovação.'},422);
        }
        return json({ok:true,product_id:productId,status:'approved'});
      }

      const treatmentRedo = url.pathname.match(/^\/api\/admin\/product-image-treatment\/(\d+)\/redo$/);
      if (treatmentRedo && request.method === 'POST') {
        const productId = Number(treatmentRedo[1]);
        const saved=await mirrorSupabaseRpc(env,'nisti_set_product_treatment_v1',{
          p_product_id:productId,p_action:'redo',
          p_processed_image_key:null,p_processor:null,p_processor_version:null,p_error_message:null
        },'refazer imagem tratada');
        if(saved.value?.status==='not_found') return json({error:'Produto sem imagem original.'},404);
        return json({ok:true,product_id:productId,status:'pending',precise_redo:true});
      }

      const treatmentFailed = url.pathname.match(/^\/api\/admin\/product-image-treatment\/(\d+)\/failed$/);
      if (treatmentFailed && request.method === 'POST') {
        const productId = Number(treatmentFailed[1]);
        const body = await request.json().catch(()=>({}));
        const reason = String(body?.error || 'Tratamento automático sem confiança suficiente.').slice(0,500);
        const saved=await mirrorSupabaseRpc(env,'nisti_set_product_treatment_v1',{
          p_product_id:productId,p_action:'failed',
          p_processed_image_key:null,
          p_processor:PRODUCT_IMAGE_PROCESSOR,
          p_processor_version:PRODUCT_IMAGE_PROCESSOR_VERSION,
          p_error_message:reason
        },'falha de imagem tratada');
        if(saved.value?.status==='not_found') return json({error:'Produto sem imagem original.'},404);
        return json({ok:true,product_id:productId,status:'failed'});
      }

      const referenceImageGet = url.pathname.match(/^\/api\/reference-images\/(\d+)$/);
      if (referenceImageGet && request.method === 'GET') {
        const reference = await supabaseReferenceById(env,Number(referenceImageGet[1]));
        if (!reference?.image_key) return new Response('Not found',{status:404});
        const object = await env.PRODUCT_IMAGES.get(reference.image_key);
        if (!object) return new Response('Not found',{status:404});
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set(
          'cache-control',
          url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'private, max-age=300'
        );
        return new Response(object.body,{headers});
      }

      const coverReferences = url.pathname.match(/^\/api\/admin\/covers\/([^/]+)\/references$/);      const coverReferences = url.pathname.match(/^\/api\/admin\/covers\/([^/]+)\/references$/);
      if (coverReferences && request.method === 'GET') {
        const capaCode = decodeURIComponent(coverReferences[1]);
        return json({
          ok: true,
          capa_code: normalizeCapaCode(capaCode),
          references: await listCoverReferences(env, capaCode),
          max_extra_references: EXTRA_REFERENCE_LIMIT
        });
      }

      if (coverReferences && request.method === 'POST') {
        const capaCode = decodeURIComponent(coverReferences[1]);
        const form = await request.formData();
        const file = form.get('image');
        const kind = form.get('kind');
        const reference = await addCoverReference(env, capaCode, file, kind);
        return json({ ok: true, reference }, 201);
      }

      const deleteReference = url.pathname.match(/^\/api\/admin\/cover-references\/(\d+)$/);
      if (deleteReference && request.method === 'DELETE') {
        return json({
          ok: true,
          deleted: await deleteExtraReference(env, Number(deleteReference[1]))
        });
      }

      if (url.pathname === '/api/admin/trained-references' && request.method === 'GET') {
        const rows=await supabaseRpc(env,'nisti_trained_references_v1',{p_limit:200});
        const references=(Array.isArray(rows)?rows:[]).map(row=>({
          ...row,
          image_url:referenceImageUrl(row),
          is_indexed:row.is_indexed === true || Number(row.is_indexed) > 0
        }));
        return json({ok:true,references});
      }

      if (url.pathname === '/api/admin/cover-index' && request.method === 'GET') {
        const model=env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
        const stats=await supabaseRpc(env,'nisti_cover_index_v1',{
          p_embedding_model:model,
          p_dimensions:EMBEDDING_DIMENSIONS
        });
        return json({
          reference_covers:Number(stats?.reference_covers || 0),
          reference_images:Number(stats?.reference_images || 0),
          indexed_references:Number(stats?.indexed_references || 0),
          indexed_covers:Number(stats?.indexed_covers || 0),
          pending_references:Number(stats?.pending_references || 0),
          pending_covers:Number(stats?.pending_covers || 0),
          embedding_model:model,
          embedding_dimensions:EMBEDDING_DIMENSIONS,
          top_k:TOP_K_REFERENCES
        });
      }

      if (url.pathname === '/api/admin/system-notifications' && request.method === 'GET') {      if (url.pathname === '/api/admin/system-notifications' && request.method === 'GET') {
        const limit = Number(url.searchParams.get('limit')) || 80;
        const [notifications, unreadCount] = await Promise.all([
          listAdminSystemNotifications(env, limit),
          getAdminSystemUnreadCount(env)
        ]);
        return json({ ok: true, notifications, unread_count: unreadCount }, 200, { 'cache-control': 'no-store' });
      }

      if (url.pathname === '/api/admin/system-notifications/unread-count' && request.method === 'GET') {
        const count = await getAdminSystemUnreadCount(env);
        return json({ ok: true, unread_count: count }, 200, { 'cache-control': 'no-store' });
      }

      const readAdminNotification = url.pathname.match(/^\/api\/admin\/system-notifications\/(\d+)\/read$/);
      if (readAdminNotification && request.method === 'POST') {
        const notificationId = Number(readAdminNotification[1]);
        const success = await markAdminSystemNotificationRead(env, notificationId);
        const unreadCount = await getAdminSystemUnreadCount(env);
        return json({ ok: success, unread_count: unreadCount }, success ? 200 : 404, { 'cache-control': 'no-store' });
      }

      if (url.pathname === '/api/admin/system-notifications/mark-all-read' && request.method === 'POST') {
        const updated = await markAllAdminSystemNotificationsRead(env);
        return json({ ok: true, marked_count: updated, unread_count: 0 }, 200, { 'cache-control': 'no-store' });
      }

      if (url.pathname === '/api/notifications' && request.method === 'GET') {
        const userId = request.headers.get('x-user-id') || url.searchParams.get('user_id') || 'anonymous';
        const limit = Number(url.searchParams.get('limit')) || 50;
        const notifications = await listUserNotifications(env, userId, limit);
        const unreadCount = await getUnreadNotificationsCount(env, userId);
        return json({ ok: true, notifications, unread_count: unreadCount });
      }

      if (url.pathname === '/api/notifications/unread-count' && request.method === 'GET') {
        const userId = request.headers.get('x-user-id') || url.searchParams.get('user_id') || 'anonymous';
        const count = await getUnreadNotificationsCount(env, userId);
        return json({ ok: true, unread_count: count });
      }

      const readSingle = url.pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
      if (readSingle && request.method === 'POST') {
        const notificationId = Number(readSingle[1]);
        const body = await request.json().catch(() => ({}));
        const userId = request.headers.get('x-user-id') || body?.user_id || url.searchParams.get('user_id') || 'anonymous';
        const success = await markNotificationRead(env, notificationId, userId);
        const unreadCount = await getUnreadNotificationsCount(env, userId);
        return json({ ok: success, unread_count: unreadCount });
      }

      if (url.pathname === '/api/notifications/mark-all-read' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const userId = request.headers.get('x-user-id') || body?.user_id || url.searchParams.get('user_id') || 'anonymous';
        const updated = await markAllNotificationsRead(env, userId);
        return json({ ok: true, marked_count: updated, unread_count: 0 });
      }

      if (url.pathname === '/api/admin/push/six-covers' && request.method === 'GET') {
        const payload = {
          title:'6 Novas Capas Cadastradas',
          body:'As capas PQV1, PQV2, PQV3, PQV4, PQV5 e PQV6 (Pequenas Aventuras) já estão prontas no catálogo.',
          image_url:'https://nisti-identificacao.lksntz1411.workers.dev/api/images/210',
          url:'/'
        };

        const rows=await supabaseRpc(env,'nisti_list_push_subscriptions_v1',{});
        const subscriptions=Array.isArray(rows)?rows:[];
        const sendResults=[];

        await Promise.all(subscriptions.map(async sub=>{
          try {
            const res=await sendWebPushNotification(env,sub,payload);
            sendResults.push({sub_id:sub.id,status:res.status});
          } catch(err) {
            sendResults.push({sub_id:sub.id,error:err.message});
          }
        }));

        return json({ok:true,sent_count:sendResults.length,results:sendResults});
      }

      if (url.pathname === '/api/admin/push/debug' && request.method === 'GET') {
        const privateKey=env.VAPID_PRIVATE_KEY ? 'presente (tamanho: ' + env.VAPID_PRIVATE_KEY.length + ')' : 'ausente';
        const apiKey=env.GEMINI_API_KEY ? 'presente' : 'ausente';
        const publicKey=env.VAPID_PUBLIC_KEY ? 'presente' : 'usando default';

        const rows=await supabaseRpc(env,'nisti_list_push_subscriptions_v1',{});
        const subscriptions=Array.isArray(rows)?rows:[];
        const testPayload={
          title:'Teste de Sinal · NISTI PRINT',
          body:'Verificando integridade das conexões push em segundo plano.',
          url:'/'
        };

        const sendResults=[];
        for(const sub of subscriptions) {
          try {
            const res=await sendWebPushNotification(env,sub,testPayload);
            sendResults.push({
              id:sub.id,
              user_id:sub.user_id,
              endpoint:sub.endpoint.slice(0,50)+'...',
              ok:res.ok,
              status:res.status
            });
          } catch(err) {
            sendResults.push({
              id:sub.id,
              user_id:sub.user_id,
              endpoint:sub.endpoint.slice(0,50)+'...',
              ok:false,
              error:err.message
            });
          }
        }

        return json({
          vapid_private_key:privateKey,
          gemini_api_key:apiKey,
          vapid_public_key:publicKey,
          active_subscriptions_count:subscriptions.length,
          send_results:sendResults
        });
      }

      if (url.pathname === '/api/admin/notifications/test' && request.method === 'POST') {      if (url.pathname === '/api/admin/notifications/test' && request.method === 'POST') {
        const randomId = Math.floor(100 + Math.random() * 900);
        const capaCode = `TEST${randomId}`;
        const saved=await recordNewCoverNotification(env,{
          capaCode,
          productId:null,
          sku:'TEST_SKU',
          productName:'Capa de Teste do Sistema',
          variacao:'Variação Teste',
          platform:'SHOPEE',
          imageKey:null
        });
        return json({
          ok:Boolean(saved),
          capa_code:capaCode,
          created:Boolean(saved?.created),
          authority:supabasePrimaryWritesRequested(env)?'supabase':'d1'
        });
      }

      if (url.pathname === '/api/push/public-key' && request.method === 'GET') {
        return json({ ok: true, publicKey: getVapidPublicKey(env) });
      }

      if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const userId = request.headers.get('x-user-id') || body?.user_id || 'anonymous';
        const success = await savePushSubscription(env, userId, body?.subscription);
        return json({ ok: success });
      }

      if (url.pathname === '/api/push/unsubscribe' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const success = await removePushSubscription(env, body?.endpoint);
        return json({ ok: success });
      }

      if (env.ASSETS) return env.ASSETS.fetch(request);
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      const message = error?.message || 'Erro interno';
      const status = /UNIQUE constraint/i.test(message) ? 409
        : /não encontrado|não encontrada/i.test(message) ? 404
          : /máximo|imagem|arquivo|referência|CAPA_CODE/i.test(message) ? 400
            : 400;
      return json({ error: message }, status);
    }
  }
};

