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
  d1EmergencyCircuitStatus,
  preferSupabaseRead,
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

async function productTreatmentSummary(env) {
  const row = await env.DB.prepare(`
    WITH treatment_state AS (
      SELECT
        p.image_key,
        CASE WHEN p.image_key IS NOT NULL
          AND mpi.status='approved'
          AND mpi.processed_image_key IS NOT NULL
          AND mpi.source_image_key=p.image_key
          AND mpi.reviewed_by='admin'
          THEN 1 ELSE 0 END AS is_approved,
        CASE WHEN p.image_key IS NOT NULL
          AND (
            mpi.status='review'
            OR (mpi.status='approved' AND COALESCE(mpi.reviewed_by,'')<>'admin')
          )
          AND mpi.processed_image_key IS NOT NULL
          AND mpi.source_image_key=p.image_key
          AND COALESCE(mpi.processor_version,'')=?
          THEN 1 ELSE 0 END AS is_review,
        CASE WHEN p.image_key IS NOT NULL
          AND mpi.status='failed'
          AND mpi.source_image_key=p.image_key
          AND COALESCE(mpi.processor_version,'')=?
          THEN 1 ELSE 0 END AS is_failed
      FROM products p
      LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
    )
    SELECT
      SUM(CASE WHEN image_key IS NOT NULL THEN 1 ELSE 0 END) AS with_image,
      SUM(is_approved) AS approved,
      SUM(is_review) AS review,
      SUM(is_failed) AS failed,
      SUM(CASE WHEN image_key IS NOT NULL AND is_approved=0 AND is_review=0 AND is_failed=0 THEN 1 ELSE 0 END) AS pending
    FROM treatment_state
  `).bind(PRODUCT_IMAGE_PROCESSOR_VERSION,PRODUCT_IMAGE_PROCESSOR_VERSION).first();
  return {
    with_image:Number(row?.with_image || 0),
    approved:Number(row?.approved || 0),
    review:Number(row?.review || 0),
    pending:Number(row?.pending || 0),
    failed:Number(row?.failed || 0)
  };
}

async function ensureVisualReference(env, {
  capaCode,
  imageKey,
  sourceProductId = null,
  referenceKind = 'product'
}) {
  const code = normalizeCapaCode(capaCode);
  if (!code || !imageKey) throw new Error('Referência visual inválida');

  await env.DB.prepare(`
    INSERT INTO cover_visual_references (
      capa_code,image_key,source_product_id,reference_kind,active,updated_at
    ) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(capa_code,image_key) DO UPDATE SET
      source_product_id=COALESCE(excluded.source_product_id,cover_visual_references.source_product_id),
      reference_kind=excluded.reference_kind,
      active=1,
      updated_at=CURRENT_TIMESTAMP
  `).bind(code, imageKey, sourceProductId, referenceKind).run();

  return env.DB.prepare(`
    SELECT id,capa_code,image_key,source_product_id,reference_kind,active,created_at,updated_at
    FROM cover_visual_references
    WHERE capa_code=? AND image_key=?
    LIMIT 1
  `).bind(code, imageKey).first();
}

async function saveProductImage(env, id, fileBytes, contentType) {
  if (supabasePrimaryWritesRequested(env)) {
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
    if(value.old_processed_image_key) await env.PRODUCT_IMAGES.delete(value.old_processed_image_key).catch(()=>{});
    const reference=value.reference;
    return { reference_saved:true,reference_id:Number(reference?.id||0) };
  }
  const product = await env.DB.prepare(`
    SELECT p.id,p.capa_code,p.image_key,mpi.processed_image_key AS mural_processed_image_key
    FROM products p
    LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
    WHERE p.id=?
  `).bind(id).first();
  if (!product) throw new Error('Produto não encontrado');

  const key = `products/${id}/${crypto.randomUUID()}`;
  await env.PRODUCT_IMAGES.put(key, fileBytes, { httpMetadata: { contentType } });
  await env.DB.prepare(`
    UPDATE products SET image_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).bind(key, id).run();

  // A imagem do catálogo é a fonte original. O Mural usa uma derivada PNG
  // própria e precisa refazê-la sempre que essa fonte muda.
  await env.DB.prepare(`
    INSERT INTO mural_product_images (
      product_id,source_image_key,processed_image_key,status,processor,
      processor_version,reviewed_by,reviewed_at,error_message,updated_at
    ) VALUES (?,?,NULL,'pending',NULL,NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP)
    ON CONFLICT(product_id) DO UPDATE SET
      source_image_key=excluded.source_image_key,
      processed_image_key=NULL,
      status='pending',
      processor=NULL,
      processor_version=NULL,
      reviewed_by=NULL,
      reviewed_at=NULL,
      error_message=NULL,
      updated_at=CURRENT_TIMESTAMP
  `).bind(id, key).run();
  if (product.mural_processed_image_key) {
    await env.PRODUCT_IMAGES.delete(product.mural_processed_image_key).catch(()=>{});
  }

  const reference = await ensureVisualReference(env, {
    capaCode: product.capa_code,
    imageKey: key,
    sourceProductId: id,
    referenceKind: 'product'
  });

  return {
    reference_saved:true,
    reference_id: Number(reference?.id || 0)
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
  if (supabasePrimaryWritesRequested(env)) {
    const result = await mirrorSupabaseRpc(env, 'nisti_upsert_product_primary_v1', {
      p_row: {
        sku: parsed.sku, miolo_code: parsed.mioloCode, capa_code: parsed.capaCode,
        acabamento_code: parsed.acabamentoCode, wireo_code: parsed.wireoCode,
        tassel_code: parsed.tasselCode, elastico_code: parsed.elasticoCode,
        nome, variacao, platform, link, gtin: validGtin
      }
    }, 'cadastro de produto');
    const saved = result.value || {};
    if (saved.status === 'gtin_conflict') throw new Error(`EAN ${validGtin} já está vinculado a outro produto.`);
    const commerceSync = syncCommerce
      ? await syncNistiProductToCommerceSafe(env, Number(saved.id))
      : null;
    return {
      id: Number(saved.id), sku: saved.sku, capa_code: saved.capa_code,
      gtin: saved.gtin || null, created: saved.created === true,
      has_image: saved.has_image === true,
      commerce_sync: commerceSync
    };
  }

  let product = await env.DB.prepare(`SELECT id,image_key FROM products WHERE sku=?`)
    .bind(parsed.sku).first();
  if (validGtin) {
    const conflict = await env.DB.prepare('SELECT product_id FROM product_gtins WHERE gtin=? AND active=1 LIMIT 1')
      .bind(validGtin).first();
    if (conflict && Number(conflict.product_id) !== Number(product?.id || 0)) {
      throw new Error(`EAN ${validGtin} já está vinculado a outro produto.`);
    }
  }
  let created = false;

  if (!product) {
    const result = await env.DB.prepare(`
      INSERT INTO products (
        sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code,nome,variacao
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      parsed.sku, parsed.mioloCode, parsed.capaCode, parsed.acabamentoCode,
      parsed.wireoCode, parsed.tasselCode, parsed.elasticoCode, nome, variacao
    ).run();
    product = { id: result.meta.last_row_id, image_key: null };
    created = true;
  } else {
    await env.DB.prepare(`
      UPDATE products SET
        miolo_code=?,capa_code=?,acabamento_code=?,wireo_code=?,tassel_code=?,elastico_code=?,
        nome=COALESCE(?,nome),variacao=COALESCE(?,variacao),updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(
      parsed.mioloCode, parsed.capaCode, parsed.acabamentoCode,
      parsed.wireoCode, parsed.tasselCode, parsed.elasticoCode,
      nome, variacao, product.id
    ).run();
  }

  if (platform) {
    const existing = await env.DB.prepare(`
      SELECT id FROM product_platforms
      WHERE product_id=? AND platform=? ORDER BY id ASC LIMIT 1
    `).bind(product.id, platform).first();
    if (existing) {
      if (link) {
        await env.DB.prepare(`UPDATE product_platforms SET link=? WHERE id=?`)
          .bind(link, existing.id).run();
      }
    } else {
      await env.DB.prepare(`
        INSERT INTO product_platforms (product_id,platform,link) VALUES (?,?,?)
      `).bind(product.id, platform, link).run();
    }
  }

  if (validGtin) {
    await env.DB.prepare(`
      INSERT INTO product_gtins (product_id,gtin,gtin_type,source,active,updated_at)
      VALUES (?,?,'GTIN-13','NISTI',1,CURRENT_TIMESTAMP)
      ON CONFLICT(gtin) DO UPDATE SET
        product_id=excluded.product_id,source='NISTI',active=1,updated_at=CURRENT_TIMESTAMP
    `).bind(product.id, validGtin).run();
  }

  if (created) {
    await recordNewCoverNotification(env, {
      capaCode: parsed.capaCode,
      productId: product.id,
      sku: parsed.sku,
      productName: nome,
      variacao: variacao,
      platform: platform,
      imageKey: product.image_key
    }).catch(err => {
      console.error('[Error] Falha no recordNewCoverNotification em upsertCatalogProduct:', err);
    });
  }

  const commerceSync = syncCommerce
    ? await syncNistiProductToCommerceSafe(env, Number(product.id))
    : null;

  return {
    id: product.id,
    sku: parsed.sku,
    capa_code: parsed.capaCode,
    gtin: gtin || null,
    created,
    has_image: Boolean(product.image_key),
    commerce_sync: commerceSync
  };
}

async function listCoverReferences(env, capaCode) {
  if (supabaseReadsRequested(env)) {
    const results=await supabaseCoverReferences(env,normalizeCapaCode(capaCode));
    return results.map(reference=>({...reference,id:Number(reference.id),
      source_product_id:reference.source_product_id?Number(reference.source_product_id):null,
      image_url:referenceImageUrl(reference)}));
  }
  const { results } = await env.DB.prepare(`
    SELECT
      r.id,r.capa_code,r.image_key,r.source_product_id,r.reference_kind,r.active,
      r.created_at,r.updated_at
    FROM cover_visual_references r
    WHERE r.capa_code=? AND r.active=1
    ORDER BY CASE WHEN r.reference_kind='product' THEN 0 ELSE 1 END, r.id ASC
  `).bind(normalizeCapaCode(capaCode)).all();

  return (results || []).map(reference => ({
    ...reference,
    id: Number(reference.id),
    source_product_id: reference.source_product_id ? Number(reference.source_product_id) : null,
    image_url: referenceImageUrl(reference)
  }));
}

async function addCoverReference(env, capaCode, file, kind) {
  const code = normalizeCapaCode(capaCode);
  if (supabasePrimaryWritesRequested(env)) {
    if (!(file instanceof File)) throw new Error('Imagem de referência obrigatória');
    if (!String(file.type||'').startsWith('image/')) throw new Error('Arquivo deve ser uma imagem');
    if (Number(file.size||0)>MAX_REFERENCE_UPLOAD_BYTES) throw new Error('Imagem de referência excede 10 MB');
    const referenceKind=['real','perspective','personalized','difficult'].includes(String(kind||'').trim().toLowerCase())
      ? String(kind).trim().toLowerCase():'real';
    const key=`cover-references/${encodeURIComponent(code)}/${crypto.randomUUID()}`;
    const bytes=await file.arrayBuffer();
    await env.PRODUCT_IMAGES.put(key,bytes,{httpMetadata:{contentType:file.type||'image/jpeg'}});
    let prepared;
    try { prepared=await mirrorSupabaseRpc(env,'nisti_prepare_extra_reference_v1',{
      p_capa_code:code,p_image_key:key,p_reference_kind:referenceKind
    },'referência visual extra'); }
    catch(error){await env.PRODUCT_IMAGES.delete(key).catch(()=>{});throw error;}
    if(prepared.value?.status!=='ok') {
      await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
      if(prepared.value?.status==='cover_not_found') throw new Error('CAPA_CODE não encontrado no catálogo');
      if(prepared.value?.status==='limit_reached') throw new Error(`Máximo de ${EXTRA_REFERENCE_LIMIT} referências adicionais por capa`);
      throw new Error('Falha ao criar referência visual');
    }
    const reference=prepared.value.reference;
    return {...reference,id:Number(reference.id),reference_saved:true,image_url:referenceImageUrl(reference)};
  }
  const exists = await env.DB.prepare(`SELECT id FROM products WHERE capa_code=? LIMIT 1`)
    .bind(code).first();
  if (!exists) throw new Error('CAPA_CODE não encontrado no catálogo');

  if (!(file instanceof File)) throw new Error('Imagem de referência obrigatória');
  if (!String(file.type || '').startsWith('image/')) throw new Error('Arquivo deve ser uma imagem');
  if (Number(file.size || 0) > MAX_REFERENCE_UPLOAD_BYTES) {
    throw new Error('Imagem de referência excede 10 MB');
  }

  const extraCount = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM cover_visual_references
    WHERE capa_code=? AND active=1 AND reference_kind<>'product'
  `).bind(code).first();
  if (Number(extraCount?.total || 0) >= EXTRA_REFERENCE_LIMIT) {
    throw new Error(`Máximo de ${EXTRA_REFERENCE_LIMIT} referências adicionais por capa`);
  }

  const referenceKind = ['real', 'perspective', 'personalized', 'difficult']
    .includes(String(kind || '').trim().toLowerCase())
    ? String(kind).trim().toLowerCase()
    : 'real';

  const key = `cover-references/${encodeURIComponent(code)}/${crypto.randomUUID()}`;
  const bytes = await file.arrayBuffer();
  await env.PRODUCT_IMAGES.put(key, bytes, { httpMetadata: { contentType: file.type || 'image/jpeg' } });

  const reference = await ensureVisualReference(env, {
    capaCode: code,
    imageKey: key,
    sourceProductId: null,
    referenceKind
  });

  return {
    ...reference,
    id: Number(reference.id),
    reference_saved:true,
    image_url: referenceImageUrl(reference)
  };
}

async function deleteExtraReference(env, referenceId) {
  if (supabasePrimaryWritesRequested(env)) {
    const result=await mirrorSupabaseRpc(env,'nisti_delete_extra_reference_v1',{p_reference_id:referenceId},'exclusão de referência visual');
    if(result.value?.status==='not_found') throw new Error('Referência visual não encontrada');
    if(result.value?.status==='protected') throw new Error('A referência principal do produto deve ser alterada pelo mockup do produto');
    const reference=result.value?.reference;
    if(reference?.image_key) await env.PRODUCT_IMAGES.delete(reference.image_key).catch(()=>{});
    return {id:Number(reference.id),capa_code:normalizeCapaCode(reference.capa_code)};
  }
  const reference = await env.DB.prepare(`
    SELECT id,capa_code,image_key,source_product_id,reference_kind
    FROM cover_visual_references
    WHERE id=? AND active=1
    LIMIT 1
  `).bind(referenceId).first();
  if (!reference) throw new Error('Referência visual não encontrada');
  if (reference.reference_kind === 'product' || reference.source_product_id) {
    throw new Error('A referência principal do produto deve ser alterada pelo mockup do produto');
  }

  await env.DB.prepare('DELETE FROM cover_visual_references WHERE id=?')
    .bind(referenceId).run();

  if (reference.image_key) {
    await env.PRODUCT_IMAGES.delete(reference.image_key).catch(() => {});
  }

  return {
    id: Number(reference.id),
    capa_code: normalizeCapaCode(reference.capa_code)
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') {
        const reserveCircuit = d1EmergencyCircuitStatus();
        const supabaseReads = supabaseReadsRequested(env);
        const supabaseWrites = supabasePrimaryWritesRequested(env);
        return json({
          ok: true,
          service: 'nisti-identificacao',
          database: {
            primary: supabaseReads ? 'supabase' : 'd1',
            write_authority: supabaseWrites ? 'supabase' : 'd1',
            compatibility_store: supabaseReads ? 'd1' : 'supabase',
            emergency_fallback_enabled: String(env?.SUPABASE_EMERGENCY_FALLBACK_ENABLED || '') === '1',
            d1_reserve_circuit_open: reserveCircuit.open,
            d1_reserve_circuit_open_until: reserveCircuit.open_until,
            d1_reserve_circuit_remaining_ms: reserveCircuit.remaining_ms
          }
        });
      }

      if (url.pathname === '/api/sku/parse' && request.method === 'POST') {
        const { sku } = await request.json();
        return json(parseSku(sku));
      }

      if (url.pathname === '/api/products' && request.method === 'GET') {
        let source = 'd1';
        const d1Loader = async () => {
          const { results } = await env.DB.prepare(`
            WITH first_platform_id AS (
              SELECT product_id,MIN(id) AS id
              FROM product_platforms
              GROUP BY product_id
            ),
            first_platform AS (
              SELECT pp.product_id,pp.platform,pp.link
              FROM product_platforms pp
              INNER JOIN first_platform_id fp ON fp.id=pp.id
            ),
            first_gtin_id AS (
              SELECT product_id,MIN(id) AS id
              FROM product_gtins
              WHERE active=1
              GROUP BY product_id
            ),
            first_gtin AS (
              SELECT pg.product_id,pg.gtin
              FROM product_gtins pg
              INNER JOIN first_gtin_id fg ON fg.id=pg.id
            )
            SELECT
              p.id,p.sku,p.miolo_code,p.capa_code,p.acabamento_code,p.wireo_code,
              p.tassel_code,p.elastico_code,p.nome,p.variacao,p.image_key,p.created_at,
              mpi.source_image_key AS treated_source_image_key,
              mpi.processed_image_key AS treated_image_key,
              mpi.status AS treated_image_status,
              mpi.processor AS treated_image_processor,
              mpi.processor_version AS treated_image_version,
              mpi.reviewed_by AS treated_image_reviewed_by,
              fp.platform,
              fp.link,
              fg.gtin AS gtin,
              CASE WHEN fg.gtin IS NULL THEN 0 ELSE 1 END AS has_active_gtin
            FROM products p
            LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
            LEFT JOIN first_platform fp ON fp.product_id=p.id
            LEFT JOIN first_gtin fg ON fg.product_id=p.id
            ORDER BY p.id DESC
            LIMIT 1000
          `).all();
          return results || [];
        };
        const supabaseLoader = async () => {
          source = 'supabase-reserve';
          return supabaseReserveProducts(env);
        };
        const results = await preferSupabaseRead(
          env,
          supabaseLoader,
          d1Loader,
          'products:list'
        );

        return json({
          products: (results || []).map(product => {
            const treatedReady = product.treated_image_status === 'approved'
              && product.treated_image_key
              && product.treated_source_image_key === product.image_key
              && product.treated_image_reviewed_by === 'admin';
            return {
              ...product,
              has_active_gtin: product.has_active_gtin === true || Number(product.has_active_gtin) === 1,
              original_image_url: productOriginalImageUrl(product.id, product.image_key),
              image_url: product.image_key
                ? productDisplayImageUrl(product.id, product.image_key, treatedReady ? product.treated_image_key : null)
                : null,
              treated_image_ready:Boolean(treatedReady)
            };
          }),
          reserve_mode: source === 'supabase-reserve',
          read_source: source
        }, 200, {
          'x-nisti-db-source':source
        });
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
        const product = supabaseReadsRequested(env)
          ? (await supabaseReserveProducts(env)).find(row=>Number(row.id)===productId)
          : await env.DB.prepare('SELECT id,sku FROM products WHERE id=? LIMIT 1').bind(productId).first();
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
        if (supabasePrimaryWritesRequested(env)) {
          const result = await mirrorSupabaseRpc(env, 'nisti_delete_product_primary_v1', { p_id: id }, 'exclusão de produto');
          const deleted = result.value || {};
          if (deleted.status === 'not_found') return json({ error: 'Produto não encontrado' }, 404);
          const keys = new Set([deleted.image_key, deleted.processed_image_key,
            ...(Array.isArray(deleted.reference_image_keys) ? deleted.reference_image_keys : [])].filter(Boolean));
          for (const key of keys) await env.PRODUCT_IMAGES.delete(key).catch(() => {});
          return json({ ok: true, deleted_id: id });
        }
        const product = await env.DB.prepare(`
          SELECT p.capa_code,p.image_key,mpi.processed_image_key
          FROM products p
          LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
          WHERE p.id=?
        `).bind(id).first();
        if (!product) return json({ error: 'Produto não encontrado' }, 404);

        await env.DB.prepare('DELETE FROM product_platforms WHERE product_id=?').bind(id).run();
        const { results: refs } = await env.DB.prepare('SELECT id, image_key FROM cover_visual_references WHERE source_product_id=?').bind(id).all();
        for (const ref of refs || []) {
          await env.DB.prepare('DELETE FROM cover_visual_references WHERE id=?').bind(ref.id).run();
          if (ref.image_key && ref.image_key !== product.image_key) {
            await env.PRODUCT_IMAGES.delete(ref.image_key).catch(() => {});
          }
        }
        await env.DB.prepare('DELETE FROM notifications WHERE product_id=?').bind(id).run();
        await env.DB.prepare('DELETE FROM products WHERE id=?').bind(id).run();

        if (product.image_key) {
          await env.PRODUCT_IMAGES.delete(product.image_key).catch(() => {});
        }
        if (product.processed_image_key) {
          await env.PRODUCT_IMAGES.delete(product.processed_image_key).catch(() => {});
        }

        return json({ ok: true, deleted_id: id });
      }

      if (productSingle && (request.method === 'PUT' || request.method === 'PATCH')) {
        const id = Number(productSingle[1]);
        const body = await request.json();
        if (supabasePrimaryWritesRequested(env)) {
          const primaryRow = { ...body };
          if (body.sku) {
            const parsed = parseSku(body.sku);
            Object.assign(primaryRow, {
              sku: parsed.sku, miolo_code: parsed.mioloCode, capa_code: parsed.capaCode,
              acabamento_code: parsed.acabamentoCode, wireo_code: parsed.wireoCode,
              tassel_code: parsed.tasselCode, elastico_code: parsed.elasticoCode
            });
          }
          const result = await mirrorSupabaseRpc(env, 'nisti_update_product_primary_v1', {
            p_id: id, p_row: primaryRow
          }, 'edição de produto');
          if (result.value?.status === 'not_found') return json({ error: 'Produto não encontrado' }, 404);
          const commerceSync = await syncNistiProductToCommerceSafe(env, id);
          scheduleCommerceReconcile(ctx, env, id, commerceSync);
          return json({ ok: true, id, updated: true, commerce_sync: commerceSync });
        }
        const existing = await env.DB.prepare('SELECT * FROM products WHERE id=?').bind(id).first();
        if (!existing) return json({ error: 'Produto não encontrado' }, 404);

        let parsed = {
          sku: existing.sku,
          mioloCode: existing.miolo_code,
          capaCode: existing.capa_code,
          acabamentoCode: existing.acabamento_code,
          wireoCode: body.wireo_code || existing.wireo_code,
          tasselCode: body.tassel_code || existing.tassel_code,
          elasticoCode: body.elastico_code || existing.elastico_code
        };

        if (body.sku && body.sku !== existing.sku) {
          parsed = parseSku(body.sku);
        }

        await env.DB.prepare(`
          UPDATE products SET
            sku = ?, miolo_code = ?, capa_code = ?, acabamento_code = ?,
            wireo_code = ?, tassel_code = ?, elastico_code = ?,
            nome = ?, variacao = ?
          WHERE id = ?
        `).bind(
          parsed.sku, parsed.mioloCode, parsed.capaCode, parsed.acabamentoCode,
          parsed.wireoCode, parsed.tasselCode, parsed.elasticoCode,
          body.nome !== undefined ? body.nome : existing.nome,
          body.variacao !== undefined ? body.variacao : existing.variacao,
          id
        ).run();

        if (body.platform !== undefined) {
          await env.DB.prepare('DELETE FROM product_platforms WHERE product_id=?').bind(id).run();
          const plat = String(body.platform || '').trim().toUpperCase();
          if (plat) {
            await env.DB.prepare('INSERT INTO product_platforms (product_id, platform, link) VALUES (?, ?, ?)')
              .bind(id, plat, body.link || null).run();
          }
        }

        const commerceSync = await syncNistiProductToCommerceSafe(env, id);
        scheduleCommerceReconcile(ctx, env, id, commerceSync);
        return json({ ok: true, id, updated: true, commerce_sync: commerceSync });
      }

      const imageUpload = url.pathname.match(/^\/api\/products\/(\d+)\/image$/);
      if (imageUpload && request.method === 'POST') {
        const id = Number(imageUpload[1]);
        const form = await request.formData();
        const file = form.get('image');
        if (!(file instanceof File)) return json({ error: 'Imagem obrigatória' }, 400);
        if (!file.type.startsWith('image/')) return json({ error: 'Arquivo deve ser uma imagem' }, 400);
        const saved = await saveProductImage(env, id, await file.arrayBuffer(), file.type);

        const prod = supabaseReadsRequested(env)
          ? await supabaseProductImageContext(env,id)
          : await env.DB.prepare('SELECT capa_code, image_key FROM products WHERE id=?').bind(id).first();
        if (prod?.image_key) {
          await updateNotificationImage(env, id, prod.capa_code, prod.image_key).catch(() => {});
        }

        const commerceSync = await syncNistiProductToCommerceSafe(env, id);
        return json({
          ok: true,
          image_url: productDisplayImageUrl(id, prod?.image_key),
          original_image_url: productOriginalImageUrl(id, prod?.image_key),
          reference_saved: saved.reference_saved,
          reference_id: saved.reference_id,
          commerce_sync: commerceSync
        });
      }

      const imageGet = url.pathname.match(/^\/api\/images\/(\d+)$/);
      if (imageGet && request.method === 'GET') {
        const product = supabaseReadsRequested(env)
          ? await supabaseProductImageContext(env,Number(imageGet[1]))
          : await env.DB.prepare(`SELECT image_key FROM products WHERE id=?`).bind(Number(imageGet[1])).first();
        if (!product?.image_key) return new Response('Not found', { status: 404 });
        const object = await env.PRODUCT_IMAGES.get(product.image_key);
        if (!object) return new Response('Not found', { status: 404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set(
          'cache-control',
          url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'private, max-age=300'
        );
        return new Response(object.body, { headers });
      }

      const displayImageGet = url.pathname.match(/^\/api\/product-images\/(\d+)$/);
      if (displayImageGet && request.method === 'GET') {
        const productId = Number(displayImageGet[1]);
        const row = supabaseReadsRequested(env)
          ? await supabaseProductImageContext(env,productId)
          : await env.DB.prepare(`
          SELECT
            p.image_key,
            mpi.source_image_key,
            mpi.processed_image_key,
            mpi.status,
            mpi.processor,
            mpi.processor_version,
            mpi.reviewed_by
          FROM products p
          LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
          WHERE p.id=?
        `).bind(productId).first();
        if (supabaseReadsRequested(env) && row?.status === 'ok') {
          row.status = row.treatment_status;
        }
        if (!row?.image_key) return new Response('Not found', { status: 404 });

        const processedReady = row.status === 'approved'
          && row.processed_image_key
          && row.source_image_key === row.image_key
          && row.reviewed_by === 'admin';
        let object = processedReady ? await env.PRODUCT_IMAGES.get(row.processed_image_key) : null;
        let servedKey = processedReady && object ? row.processed_image_key : row.image_key;
        if (!object) object = await env.PRODUCT_IMAGES.get(row.image_key);
        if (!object) return new Response('Not found', { status: 404 });

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('x-nisti-image-source', servedKey === row.image_key ? 'original' : 'treated');
        headers.set(
          'cache-control',
          url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'private, max-age=300'
        );
        return new Response(object.body, { headers });
      }

      if (url.pathname === '/api/admin/product-image-treatment/summary' && request.method === 'GET') {
        const useSupabase = supabaseReadsRequested(env);
        const summary = useSupabase
          ? await supabaseProductTreatmentSummary(env,PRODUCT_IMAGE_PROCESSOR_VERSION)
          : await productTreatmentSummary(env);
        return json({
          ok:true,
          read_source:useSupabase?'supabase':'d1',
          processor_version:PRODUCT_IMAGE_PROCESSOR_VERSION,
          summary
        });
      }

      if (url.pathname === '/api/admin/product-image-treatment/pending' && request.method === 'GET') {
        const requestedLimit = Number(url.searchParams.get('limit') || 3);
        const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 3;
        const requestedOffset = Number(url.searchParams.get('offset') || 0);
        const offset = Number.isInteger(requestedOffset) ? Math.max(0,requestedOffset) : 0;
        const requestedStatus = String(url.searchParams.get('status') || 'work').trim().toLowerCase();
        const status = ['work','pending','review','stale','failed'].includes(requestedStatus)
          ? requestedStatus
          : 'work';

        if (supabaseReadsRequested(env)) {
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

        const { results } = await env.DB.prepare(`
          SELECT
            p.id,p.sku,p.nome,p.image_key,p.tassel_code,
            mpi.source_image_key,mpi.processed_image_key,mpi.status,
            mpi.processor,mpi.processor_version,mpi.error_message
          FROM products p
          LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
          WHERE p.image_key IS NOT NULL
            AND (
              mpi.product_id IS NULL
              OR mpi.source_image_key IS NOT p.image_key
              OR mpi.status IN ('pending','stale')
              OR (
                COALESCE(mpi.reviewed_by,'')<>'admin'
                AND COALESCE(mpi.processor_version,'')<>?
              )
            )
          ORDER BY
            CASE COALESCE(mpi.status,'pending')
              WHEN 'pending' THEN 0
              WHEN 'review' THEN 1
              WHEN 'stale' THEN 2
              ELSE 3
            END,
            p.id ASC
          LIMIT ?
        `).bind(PRODUCT_IMAGE_PROCESSOR_VERSION,limit).all();

        return json({
          ok:true,
          read_source:'d1',
          processor_version:PRODUCT_IMAGE_PROCESSOR_VERSION,
          status:'work',
          total:(results || []).length,
          limit,
          offset:0,
          items:(results || []).map(row=>({
            id:Number(row.id),
            sku:row.sku || null,
            name:row.nome || null,
            tassel_code:row.tassel_code || 'X',
            image_key:row.image_key,
            status:row.status || 'pending',
            queue_status:null,
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

        const product = supabasePrimaryWritesRequested(env) ? await supabaseProductImageContext(env,productId) : await env.DB.prepare(`
          SELECT p.id,p.image_key,mpi.processed_image_key
          FROM products p
          LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
          WHERE p.id=?
        `).bind(productId).first();
        if (!product) return json({ error:'Produto não encontrado.' },404);
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
          httpMetadata:{ contentType:'image/png' },
          customMetadata:{
            sourceImageKey:String(product.image_key),
            processor:PRODUCT_IMAGE_PROCESSOR,
            processorVersion:PRODUCT_IMAGE_PROCESSOR_VERSION,
            width:String(png.width),
            height:String(png.height)
          }
        });

        if (supabasePrimaryWritesRequested(env)) {
          let saved;
          try { saved=await mirrorSupabaseRpc(env,'nisti_set_product_treatment_v1',{
            p_product_id:productId,p_action:'review',p_processed_image_key:key,
            p_processor:PRODUCT_IMAGE_PROCESSOR,p_processor_version:PRODUCT_IMAGE_PROCESSOR_VERSION,p_error_message:null
          },'imagem tratada'); }
          catch(error){await env.PRODUCT_IMAGES.delete(key).catch(()=>{});throw error;}
          if(saved.value?.status!=='ok'){await env.PRODUCT_IMAGES.delete(key).catch(()=>{});return json({error:'Produto não encontrado.'},404);}
          if(saved.value.old_processed_image_key && saved.value.old_processed_image_key!==key) await env.PRODUCT_IMAGES.delete(saved.value.old_processed_image_key).catch(()=>{});
        } else await env.DB.prepare(`
          INSERT INTO mural_product_images (
            product_id,source_image_key,processed_image_key,status,processor,
            processor_version,reviewed_by,reviewed_at,error_message,updated_at
          ) VALUES (?, ?, ?, 'review', ?, ?, NULL, NULL, NULL, CURRENT_TIMESTAMP)
          ON CONFLICT(product_id) DO UPDATE SET
            source_image_key=excluded.source_image_key,
            processed_image_key=excluded.processed_image_key,
            status='review',
            processor=excluded.processor,
            processor_version=excluded.processor_version,
            reviewed_by=NULL,
            reviewed_at=NULL,
            error_message=NULL,
            updated_at=CURRENT_TIMESTAMP
        `).bind(productId,product.image_key,key,PRODUCT_IMAGE_PROCESSOR,PRODUCT_IMAGE_PROCESSOR_VERSION).run();

        if (product.processed_image_key && product.processed_image_key !== key) {
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
        const row = supabaseReadsRequested(env) ? await supabaseProductImageContext(env,Number(treatmentPreview[1])) : await env.DB.prepare(`
          SELECT p.image_key,mpi.source_image_key,mpi.processed_image_key
          FROM products p
          LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
          WHERE p.id=?
        `).bind(Number(treatmentPreview[1])).first();
        if (!row?.processed_image_key || row.source_image_key !== row.image_key) {
          return new Response('Not found',{ status:404 });
        }
        const object = await env.PRODUCT_IMAGES.get(row.processed_image_key);
        if (!object) return new Response('Not found',{ status:404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('cache-control','private, no-store');
        headers.set('x-content-type-options','nosniff');
        return new Response(object.body,{ headers });
      }

      const treatmentApprove = url.pathname.match(/^\/api\/admin\/product-image-treatment\/(\d+)\/approve$/);
      if (treatmentApprove && request.method === 'POST') {
        const productId = Number(treatmentApprove[1]);
        if (supabasePrimaryWritesRequested(env)) {
          const saved=await mirrorSupabaseRpc(env,'nisti_set_product_treatment_v1',{p_product_id:productId,p_action:'approve',
            p_processed_image_key:null,p_processor:null,p_processor_version:null,p_error_message:null},'aprovação de imagem tratada');
          if(saved.value?.status==='not_found') return json({error:'Produto sem imagem original.'},404);
          if(saved.value?.status==='invalid_derivative') return json({error:'Este produto ainda não possui uma imagem tratada válida para aprovação.'},422);
          return json({ok:true,product_id:productId,status:'approved'});
        }
        const row = await env.DB.prepare(`
          SELECT p.image_key,mpi.source_image_key,mpi.processed_image_key,mpi.status
          FROM products p
          LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
          WHERE p.id=?
        `).bind(productId).first();
        if (!row?.image_key) return json({ error:'Produto sem imagem original.' },404);
        if (!row.processed_image_key || row.source_image_key !== row.image_key) {
          return json({ error:'Este produto ainda não possui uma imagem tratada válida para aprovação.' },422);
        }
        await env.DB.prepare(`
          UPDATE mural_product_images
          SET status='approved',reviewed_by='admin',reviewed_at=CURRENT_TIMESTAMP,
              error_message=NULL,updated_at=CURRENT_TIMESTAMP
          WHERE product_id=?
        `).bind(productId).run();
        return json({ ok:true,product_id:productId,status:'approved' });
      }

      const treatmentRedo = url.pathname.match(/^\/api\/admin\/product-image-treatment\/(\d+)\/redo$/);
      if (treatmentRedo && request.method === 'POST') {
        const productId = Number(treatmentRedo[1]);
        if (supabasePrimaryWritesRequested(env)) {
          const saved=await mirrorSupabaseRpc(env,'nisti_set_product_treatment_v1',{p_product_id:productId,p_action:'redo',
            p_processed_image_key:null,p_processor:null,p_processor_version:null,p_error_message:null},'refazer imagem tratada');
          if(saved.value?.status==='not_found') return json({error:'Produto sem imagem original.'},404);
          return json({ok:true,product_id:productId,status:'pending',precise_redo:true});
        }
        const row = await env.DB.prepare('SELECT id,image_key FROM products WHERE id=?').bind(productId).first();
        if (!row?.image_key) return json({ error:'Produto sem imagem original.' },404);
        await env.DB.prepare(`
          INSERT INTO mural_product_images (product_id,source_image_key,status,processor,reviewed_by,reviewed_at,error_message,updated_at)
          VALUES (?,?,'pending','system-precise-redo',NULL,NULL,NULL,CURRENT_TIMESTAMP)
          ON CONFLICT(product_id) DO UPDATE SET
            source_image_key=excluded.source_image_key,status='pending',processor='system-precise-redo',reviewed_by=NULL,
            reviewed_at=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP
        `).bind(productId,row.image_key).run();
        return json({ ok:true,product_id:productId,status:'pending',precise_redo:true });
      }

      const treatmentFailed = url.pathname.match(/^\/api\/admin\/product-image-treatment\/(\d+)\/failed$/);
      if (treatmentFailed && request.method === 'POST') {
        const productId = Number(treatmentFailed[1]);
        const body = await request.json().catch(()=>({}));
        const reason = String(body?.error || 'Tratamento automático sem confiança suficiente.').slice(0,500);
        if (supabasePrimaryWritesRequested(env)) {
          const saved=await mirrorSupabaseRpc(env,'nisti_set_product_treatment_v1',{p_product_id:productId,p_action:'failed',
            p_processed_image_key:null,p_processor:PRODUCT_IMAGE_PROCESSOR,p_processor_version:PRODUCT_IMAGE_PROCESSOR_VERSION,
            p_error_message:reason},'falha de imagem tratada');
          if(saved.value?.status==='not_found') return json({error:'Produto sem imagem original.'},404);
          return json({ok:true,product_id:productId,status:'failed'});
        }
        const product = await env.DB.prepare('SELECT id,image_key FROM products WHERE id=?').bind(productId).first();
        if (!product?.image_key) return json({ error:'Produto sem imagem original.' },404);

        await env.DB.prepare(`
          INSERT INTO mural_product_images (
            product_id,source_image_key,processed_image_key,status,processor,
            processor_version,reviewed_by,reviewed_at,error_message,updated_at
          ) VALUES (?, ?, NULL, 'failed', ?, ?, NULL, NULL, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(product_id) DO UPDATE SET
            source_image_key=excluded.source_image_key,
            processed_image_key=NULL,
            status='failed',
            processor=excluded.processor,
            processor_version=excluded.processor_version,
            reviewed_by=NULL,
            reviewed_at=NULL,
            error_message=excluded.error_message,
            updated_at=CURRENT_TIMESTAMP
        `).bind(productId,product.image_key,PRODUCT_IMAGE_PROCESSOR,PRODUCT_IMAGE_PROCESSOR_VERSION,reason).run();

        return json({ ok:true, product_id:productId, status:'failed' });
      }


      const referenceImageGet = url.pathname.match(/^\/api\/reference-images\/(\d+)$/);
      if (referenceImageGet && request.method === 'GET') {
        const reference = supabaseReadsRequested(env) ? await supabaseReferenceById(env,Number(referenceImageGet[1])) : await env.DB.prepare(`
          SELECT image_key FROM cover_visual_references WHERE id=? AND active=1
        `).bind(Number(referenceImageGet[1])).first();
        if (!reference?.image_key) return new Response('Not found', { status: 404 });
        const object = await env.PRODUCT_IMAGES.get(reference.image_key);
        if (!object) return new Response('Not found', { status: 404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set(
          'cache-control',
          url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'private, max-age=300'
        );
        return new Response(object.body, { headers });
      }

      const coverReferences = url.pathname.match(/^\/api\/admin\/covers\/([^/]+)\/references$/);
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

      if (url.pathname === '/api/admin/system-notifications' && request.method === 'GET') {
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
          title: '6 Novas Capas Cadastradas',
          body: 'As capas PQV1, PQV2, PQV3, PQV4, PQV5 e PQV6 (Pequenas Aventuras) já estão prontas no catálogo.',
          image_url: 'https://nisti-identificacao.lksntz1411.workers.dev/api/images/210',
          url: '/'
        };
        
        let subscriptions;
        if (supabaseReadsRequested(env)) {
          const rows=await supabaseRpc(env,'nisti_list_push_subscriptions_v1',{});
          subscriptions=Array.isArray(rows)?rows:[];
        } else {
          const { results } = await env.DB.prepare(`
            SELECT id, endpoint, p256dh, auth
            FROM push_subscriptions
          `).all();
          subscriptions=results || [];
        }
        const sendResults = [];
        
        await Promise.all(subscriptions.map(async sub => {
          try {
            const res = await sendWebPushNotification(env, sub, payload);
            sendResults.push({ sub_id: sub.id, status: res.status });
          } catch (err) {
            sendResults.push({ sub_id: sub.id, error: err.message });
          }
        }));
        
        return json({ ok: true, sent_count: sendResults.length, results: sendResults });
      }

      if (url.pathname === '/api/admin/push/debug' && request.method === 'GET') {
        const privateKey = env.VAPID_PRIVATE_KEY ? 'presente (tamanho: ' + env.VAPID_PRIVATE_KEY.length + ')' : 'ausente';
        const publicKey = env.VAPID_PUBLIC_KEY ? 'presente' : 'usando default';

        let subscriptions;
        if (supabaseReadsRequested(env)) {
          const rows=await supabaseRpc(env,'nisti_list_push_subscriptions_v1',{});
          subscriptions=Array.isArray(rows)?rows:[];
        } else {
          const { results } = await env.DB.prepare(`
            SELECT id, user_id, endpoint, p256dh, auth
            FROM push_subscriptions
          `).all();
          subscriptions=results || [];
        }

        const testPayload = {
          title: 'Teste de Sinal · NISTI PRINT',
          body: 'Verificando integridade das conexões push em segundo plano.',
          url: '/'
        };

        const sendResults = [];
        for (const sub of subscriptions) {
          try {
            const res = await sendWebPushNotification(env, sub, testPayload);
            sendResults.push({
              id: sub.id,
              user_id: sub.user_id,
              endpoint: sub.endpoint.slice(0, 50) + '...',
              ok: res.ok,
              status: res.status
            });
          } catch (err) {
            sendResults.push({
              id: sub.id,
              user_id: sub.user_id,
              endpoint: sub.endpoint.slice(0, 50) + '...',
              ok: false,
              error: err.message
            });
          }
        }

        return json({
          vapid_private_key: privateKey,
          vapid_public_key: publicKey,
          active_subscriptions_count: subscriptions.length,
          send_results: sendResults
        });
      }

      if (url.pathname === '/api/admin/notifications/test' && request.method === 'POST') {
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

